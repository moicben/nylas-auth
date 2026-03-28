-- Résultat de la vérif Link (post-auth) : true si expéditeur @link.com détecté sur sujet "Link : "
ALTER TABLE public.grants
  ADD COLUMN IF NOT EXISTS have_link boolean;

COMMENT ON COLUMN public.grants.have_link IS
  'Mis à jour par POST /api/post-auth : true si compte Link détecté (mail sujet Link : depuis link.com), sinon false.';
