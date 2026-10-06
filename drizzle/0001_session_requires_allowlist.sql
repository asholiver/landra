-- Database-level enforcement of the approved list (BR1): a session can only be created for a
-- user whose email is currently in allowed_email. This complements the Better Auth hook (a
-- plain, racy SELECT) and closes the race with `pnpm allowlist remove`.
--
-- The trigger locks the allowed_email row with FOR SHARE for the rest of the inserting
-- transaction. The removal transaction deletes that row first (taking an exclusive row lock),
-- then deletes the user's sessions. Under READ COMMITTED every interleaving ends with no
-- surviving session for a removed email:
--   * insert checks first: removal's DELETE waits for the insert's transaction to commit, then
--     its later session DELETE (new snapshot) sees and removes the new session.
--   * removal deletes first: the trigger's FOR SHARE waits for removal to finish; on commit the
--     row is gone, so the insert is refused (on rollback the row remains and the insert is allowed).
--   * removal already committed: the row is absent and the insert is refused.
CREATE FUNCTION "enforce_session_allowlist"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "allowed_email" AS "approved"
  JOIN "user" AS "owner" ON lower("owner"."email") = "approved"."email"
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
CREATE TRIGGER "session_requires_allowlist"
BEFORE INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION "enforce_session_allowlist"();
