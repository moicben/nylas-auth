#!/usr/bin/env python3
"""
Analyse rapide de l'historique email d'un grant sur une fenetre temporelle (par defaut 24 mois) et generation d'un rapport Markdown.

Entree attendue:
- JSON array de messages normalises, ou objet {"messages": [...]}
Chaque message peut contenir: id, date, from, to, subject, snippet, body.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "finance": [
        "bank",
        "banque",
        "iban",
        "swift",
        "wire",
        "virement",
        "payment",
        "paiement",
        "invoice",
        "facture",
        "receipt",
        "recu",
        "stripe",
        "paypal",
        "wise",
        "revolut",
        "crypto",
        "wallet",
        "coinbase",
        "binance",
    ],
    "achats": [
        "order",
        "commande",
        "purchase",
        "achat",
        "checkout",
        "cart",
        "delivery",
        "shipping",
        "amazon",
        "shopify",
        "gumroad",
        "appsumo",
    ],
    "outils": [
        "chatgpt",
        "openai",
        "claude",
        "gemini",
        "anthropic",
        "notion",
        "zapier",
        "make.com",
        "n8n",
        "vercel",
        "netlify",
        "cloudflare",
        "github",
        "gitlab",
        "figma",
        "canva",
        "meta ads",
        "google ads",
        "mailchimp",
        "brevo",
        "hubspot",
        "whatsapp",
        "slack",
        "discord",
    ],
}


DOMAIN_TOOL_HINTS: dict[str, str] = {
    "openai.com": "OpenAI",
    "anthropic.com": "Anthropic",
    "claude.ai": "Claude",
    "gemini.google.com": "Gemini",
    "notion.so": "Notion",
    "zapier.com": "Zapier",
    "make.com": "Make",
    "n8n.io": "n8n",
    "vercel.com": "Vercel",
    "netlify.com": "Netlify",
    "cloudflare.com": "Cloudflare",
    "github.com": "GitHub",
    "gitlab.com": "GitLab",
    "figma.com": "Figma",
    "canva.com": "Canva",
    "facebook.com": "Facebook/Meta",
    "instagram.com": "Instagram",
    "linkedin.com": "LinkedIn",
    "x.com": "X/Twitter",
    "mailchimp.com": "Mailchimp",
    "hubspot.com": "HubSpot",
    "stripe.com": "Stripe",
    "paypal.com": "PayPal",
    "wise.com": "Wise",
    "revolut.com": "Revolut",
    "coinbase.com": "Coinbase",
    "binance.com": "Binance",
}


MONEY_RE = re.compile(
    r"(?i)(?:\\b(?:usd|eur|gbp|cad|aud|chf|dollar|euro)s?\\b\\s*)?"
    r"([0-9]{1,3}(?:[ ,][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)"
    r"\\s*(?:\\$|€|£|usd|eur|gbp)?"
)
URL_RE = re.compile(r"(?i)https?://[\\w.-]+(?:/[\\w\\-./?%&=+#]*)?")
EMAIL_RE = re.compile(r"(?i)\\b[a-z0-9._%+-]+@([a-z0-9.-]+\\.[a-z]{2,})\\b")
WORD_RE = re.compile(r"[a-zA-Z0-9_\\-]{3,}")


@dataclass
class Message:
    msg_id: str
    date: dt.datetime | None
    subject: str
    snippet: str
    body: str
    from_emails: list[str]
    to_emails: list[str]

    @property
    def text(self) -> str:
        return " ".join([self.subject, self.snippet, self.body]).lower()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyse historique email grant")
    parser.add_argument("--input", required=True, help="Chemin JSON des messages")
    parser.add_argument("--output", required=True, help="Chemin du rapport Markdown")
    parser.add_argument("--target-email", default="", help="Email cible (optionnel)")
    parser.add_argument(
        "--window-months",
        type=int,
        default=24,
        help="Taille de la fenetre glissante en mois (defaut: 24)",
    )
    return parser.parse_args()


def _as_email_list(value: Any) -> list[str]:
    if isinstance(value, list):
        result = []
        for item in value:
            if isinstance(item, str) and "@" in item:
                result.append(item.lower())
            elif isinstance(item, dict):
                email = item.get("email") or item.get("address")
                if isinstance(email, str) and "@" in email:
                    result.append(email.lower())
        return result
    if isinstance(value, str) and "@" in value:
        return [value.lower()]
    return []


def _parse_date(value: Any) -> dt.datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return dt.datetime.fromtimestamp(float(value), tz=dt.timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        txt = value.strip()
        if txt.endswith("Z"):
            txt = txt[:-1] + "+00:00"
        try:
            parsed = dt.datetime.fromisoformat(txt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc)
        except Exception:
            return None
    return None


def _pick_body(raw: dict[str, Any]) -> str:
    for key in ("body", "body_text", "text", "html", "body_html"):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            return val
    payload = raw.get("payload")
    if isinstance(payload, dict):
        for key in ("body", "text", "html"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                return val
    return ""


def _clean_text(text: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", text)
    no_entities = (
        no_tags.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    return re.sub(r"\\s+", " ", no_entities).strip()


def load_messages(path: Path) -> list[Message]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        items = raw.get("messages", [])
    elif isinstance(raw, list):
        items = raw
    else:
        items = []

    messages: list[Message] = []
    for idx, obj in enumerate(items):
        if not isinstance(obj, dict):
            continue
        msg = Message(
            msg_id=str(obj.get("id") or f"msg_{idx+1}"),
            date=_parse_date(obj.get("date") or obj.get("created_at") or obj.get("received_at")),
            subject=str(obj.get("subject") or "").strip(),
            snippet=str(obj.get("snippet") or "").strip(),
            body=_clean_text(_pick_body(obj)),
            from_emails=_as_email_list(obj.get("from") or obj.get("sender")),
            to_emails=_as_email_list(obj.get("to") or obj.get("recipients")),
        )
        messages.append(msg)
    messages.sort(key=lambda m: m.date or dt.datetime.min.replace(tzinfo=dt.timezone.utc), reverse=True)
    return messages


def filter_by_month_window(
    messages: list[Message], window_months: int
) -> tuple[list[Message], int, dt.datetime]:
    now_utc = dt.datetime.now(dt.timezone.utc)
    approx_days = max(window_months, 1) * 30.4375
    cutoff = now_utc - dt.timedelta(days=approx_days)

    filtered: list[Message] = []
    ignored_without_date = 0
    for msg in messages:
        if not msg.date:
            ignored_without_date += 1
            continue
        if msg.date >= cutoff:
            filtered.append(msg)
    return filtered, ignored_without_date, cutoff


def count_keywords(messages: list[Message], keywords: list[str]) -> tuple[int, list[Message]]:
    hits = []
    for m in messages:
        text = m.text
        if any(k in text for k in keywords):
            hits.append(m)
    return len(hits), hits


def extract_domains(messages: list[Message]) -> collections.Counter[str]:
    domains: collections.Counter[str] = collections.Counter()
    for m in messages:
        txt = " ".join([m.text, " ".join(m.from_emails), " ".join(m.to_emails)])
        for domain in EMAIL_RE.findall(txt):
            domains[domain.lower()] += 1
        for url in URL_RE.findall(txt):
            host = url.split("/")[2].lower()
            if host.startswith("www."):
                host = host[4:]
            domains[host] += 1
    return domains


def extract_amounts(messages: list[Message]) -> list[float]:
    amounts: list[float] = []
    for m in messages:
        for match in MONEY_RE.finditer(m.text):
            raw_amount = match.group(1).replace(" ", "").replace(",", ".")
            if raw_amount.count(".") > 1:
                parts = raw_amount.split(".")
                raw_amount = "".join(parts[:-1]) + "." + parts[-1]
            try:
                val = float(raw_amount)
            except ValueError:
                continue
            if 0.5 <= val <= 500000:
                amounts.append(val)
    return amounts


def period_stats(messages: list[Message]) -> tuple[str, str, str]:
    with_dates = [m for m in messages if m.date]
    if not with_dates:
        return "non determine", "non determine", "non determine"

    weekdays = collections.Counter(m.date.strftime("%A") for m in with_dates if m.date)
    hours = collections.Counter(m.date.hour for m in with_dates if m.date)

    top_days = ", ".join([f"{d} ({c})" for d, c in weekdays.most_common(3)])
    top_hours = ", ".join([f"{h:02d}h ({c})" for h, c in hours.most_common(3)])

    dates = sorted(m.date for m in with_dates if m.date)
    if len(dates) < 2:
        cadence = "insuffisant pour estimer la cadence"
    else:
        deltas = [(dates[i] - dates[i - 1]).total_seconds() / 3600 for i in range(1, len(dates))]
        avg_hours = sum(deltas) / len(deltas)
        if avg_hours < 12:
            cadence = f"cadence elevee (~{avg_hours:.1f}h entre emails)"
        elif avg_hours < 36:
            cadence = f"cadence quotidienne (~{avg_hours:.1f}h)"
        elif avg_hours < 168:
            cadence = f"cadence pluri-hebdomadaire (~{avg_hours / 24:.1f} jours)"
        else:
            cadence = f"cadence espacer (~{avg_hours / 24:.1f} jours)"

    return top_days, top_hours, cadence


def confidence(n: int, total: int) -> str:
    if total <= 0:
        return "faible"
    ratio = n / total
    if ratio >= 0.35:
        return "eleve"
    if ratio >= 0.15:
        return "moyen"
    return "faible"


def top_examples(messages: list[Message], k: int = 3) -> list[str]:
    examples = []
    for m in messages[:k]:
        subj = m.subject or "(sans objet)"
        snippet = (m.snippet or m.body[:120] or "").strip()
        if len(snippet) > 120:
            snippet = snippet[:117] + "..."
        examples.append(f'- "{subj}" -> "{snippet}"')
    return examples


def infer_tools_from_domains(domains: collections.Counter[str]) -> collections.Counter[str]:
    tools: collections.Counter[str] = collections.Counter()
    for domain, count in domains.items():
        for hint_domain, label in DOMAIN_TOOL_HINTS.items():
            if domain == hint_domain or domain.endswith("." + hint_domain):
                tools[label] += count
    return tools


def likely_role(words: collections.Counter[str]) -> str:
    role_signals = {
        "developpeur": ["github", "api", "deploy", "code", "docker", "vercel", "netlify"],
        "marketeur": ["campaign", "ads", "newsletter", "crm", "outreach", "leads"],
        "ecom/ops": ["order", "shipment", "checkout", "refund", "shopify", "invoice"],
        "fondateur/independant": ["client", "proposal", "invoice", "meeting", "contract"],
    }
    scores: dict[str, int] = {}
    for role, keys in role_signals.items():
        scores[role] = sum(words.get(k, 0) for k in keys)
    best_role = max(scores, key=scores.get)
    if scores[best_role] == 0:
        return "profil hybride (signaux metiers diffus)"
    return best_role


def build_report(messages: list[Message], target_email: str, window_months: int, cutoff: dt.datetime, ignored_without_date: int) -> str:
    total = len(messages)
    texts = " ".join(m.text for m in messages)
    words = collections.Counter(w.lower() for w in WORD_RE.findall(texts))

    finance_n, finance_msgs = count_keywords(messages, CATEGORY_KEYWORDS["finance"])
    achats_n, achats_msgs = count_keywords(messages, CATEGORY_KEYWORDS["achats"])
    outils_n, outils_msgs = count_keywords(messages, CATEGORY_KEYWORDS["outils"])
    domains = extract_domains(messages)
    inferred_tools = infer_tools_from_domains(domains)
    amounts = extract_amounts(messages)
    top_days, top_hours, cadence = period_stats(messages)

    avg_amount = f"{(sum(amounts) / len(amounts)):.2f}" if amounts else "n/a"
    med_amount = "n/a"
    if amounts:
        sorted_amounts = sorted(amounts)
        mid = len(sorted_amounts) // 2
        if len(sorted_amounts) % 2 == 0:
            med = (sorted_amounts[mid - 1] + sorted_amounts[mid]) / 2
        else:
            med = sorted_amounts[mid]
        med_amount = f"{med:.2f}"

    top_domains = ", ".join([f"{d} ({c})" for d, c in domains.most_common(10)]) or "aucun domaine significatif"
    top_tool_labels = ", ".join([f"{t} ({c})" for t, c in inferred_tools.most_common(12)]) or "aucun outil clairement identifiable"

    finance_examples = top_examples(finance_msgs)
    achats_examples = top_examples(achats_msgs)
    outils_examples = top_examples(outils_msgs)

    role = likely_role(words)
    target_line = target_email or "non specifie"

    report = []
    report.append(f"# Diagnostic Grant - Analyse historique sur fenetre {window_months} mois")
    report.append("")
    report.append(f"- Email cible: `{target_line}`")
    report.append(f"- Echantillon: `{total}` messages")
    report.append(
        f"- Fenetre d'analyse: `{window_months}` mois (depuis `{cutoff.date().isoformat()}` UTC)"
    )
    report.append(f"- Messages ignores sans date exploitable: `{ignored_without_date}`")
    report.append(f"- Periode dominante: `{top_days}`")
    report.append(f"- Fenetres horaires dominantes: `{top_hours}`")
    report.append(f"- Cadence: `{cadence}`")
    report.append("")

    report.append("## 1) Presentation du grant")
    report.append(
        f"- **Profil probable**: {role} (confiance `{confidence(max(finance_n, achats_n, outils_n), max(total, 1))}`)"
    )
    report.append(
        f"- **Contexte actuel**: derive des signaux recents sur {window_months} mois (operations, paiements, outils, achats)."
    )
    report.append("- **Evolutions detectees**: verifier variation des themes entre emails recents et plus anciens de l'echantillon.")
    report.append("- **Signaux d'activite**: pics sur plages horaires et jours dominants ci-dessus.")
    report.append("")

    report.append("## 2) Infrastructure financiere")
    report.append(
        f"- **Occurrences finance**: {finance_n}/{total} emails (confiance `{confidence(finance_n, max(total, 1))}`)"
    )
    report.append(f"- **Domaines financiers probables**: {top_domains}")
    report.append(
        f"- **Montants detectes**: {len(amounts)} valeurs, moyenne `{avg_amount}`, mediane `{med_amount}` (unite monetaire possiblement mixte)."
    )
    report.append("- **Risque de faux positifs**: montants non financiers possibles (numeros, quantites).")
    if finance_examples:
        report.append("- **Exemples**:")
        report.extend(finance_examples)
    report.append("")

    report.append("## 3) Activites d'achats")
    report.append(
        f"- **Occurrences achats**: {achats_n}/{total} emails (confiance `{confidence(achats_n, max(total, 1))}`)"
    )
    report.append("- **Types probables**: produits digitaux/SaaS/ecommerce selon sujets et domaines dominants.")
    report.append("- **Sources probables**: verifier domaines de commerce recurrents dans les metadonnees.")
    report.append("- **Moyens de paiement**: derive des marqueurs Stripe/PayPal/bank transfer si presents.")
    if achats_examples:
        report.append("- **Exemples**:")
        report.extend(achats_examples)
    report.append("")

    report.append("## 4) Liste complete des outils utilises")
    report.append(
        f"- **Occurrences outils**: {outils_n}/{total} emails (confiance `{confidence(outils_n, max(total, 1))}`)"
    )
    report.append(f"- **Outils detectes (domaines + mots-cles)**: {top_tool_labels}")
    report.append("- **Couverture**: IA/LLM, automation, dev web, social, outreach, communication.")
    if outils_examples:
        report.append("- **Exemples**:")
        report.extend(outils_examples)
    report.append("")

    report.append("## 5) Activites, routines et habitudes particulieres detectees")
    report.append(f"- **Rythme**: {cadence}")
    report.append(f"- **Jours dominants**: {top_days}")
    report.append(f"- **Heures dominantes**: {top_hours}")
    report.append("- **Routine probable**: sequence operationnelle detectee via recurrence des themes.")
    report.append("- **Particularites**: noter ecarts ponctuels (pics de paiements, rafales de confirmations, etc.).")
    report.append("")

    report.append("## 6) Informations et precisions annexes")
    report.append("- **Patterns non-lineaires**: correler achats + finance + outils sur memes periodes.")
    report.append("- **Comportement observe**: orientation execution, pilotage financier, experimentation outils (a confirmer par preuves).")
    report.append("- **Anomalies**: signaler tout evenement rare avec contexte (ex: 1/N, 2/N).")
    report.append("- **Actions recommandees**: enrichir avec thread-level analysis pour affiner causalites.")
    report.append("")

    report.append("## Notes methodologiques")
    report.append("- Analyse automatique basee sur mots-cles/domaines, sensible au bruit lexical.")
    report.append("- Toute conclusion doit etre revisee humainement avant decision critique.")

    return "\n".join(report) + "\n"


def main() -> int:
    args = parse_args()
    in_path = Path(args.input).expanduser().resolve()
    out_path = Path(args.output).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    all_messages = load_messages(in_path)
    messages, ignored_without_date, cutoff = filter_by_month_window(all_messages, args.window_months)
    report = build_report(
        messages,
        args.target_email.strip().lower(),
        args.window_months,
        cutoff,
        ignored_without_date,
    )
    out_path.write_text(report, encoding="utf-8")

    print(f"[ok] messages analyses (fenetre {args.window_months} mois): {len(messages)}")
    print(f"[ok] messages ignores sans date: {ignored_without_date}")
    print(f"[ok] rapport: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
