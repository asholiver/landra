-- Hardens the session trigger from 0001 (append-only history: 0001 is left as it was):
--   * tables are schema-qualified and the function pins its search_path, so a hostile
--     search_path cannot make it read different tables;
--   * the trigger also fires when an existing session is moved to another user
--     (UPDATE OF user_id), not just on INSERT.
-- The locking and race analysis in 0001 is unchanged.
CREATE OR REPLACE FUNCTION "enforce_session_allowlist"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM public."allowed_email" AS "approved"
  JOIN public."user" AS "owner" ON pg_catalog.lower("owner"."email") = "approved"."email"
  WHERE "owner"."id" = NEW."user_id"
  FOR SHARE OF "approved";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session refused: email is not on the approved list'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER "session_requires_allowlist"
BEFORE INSERT OR UPDATE OF "user_id" ON public."session"
FOR EACH ROW EXECUTE FUNCTION "enforce_session_allowlist"();
