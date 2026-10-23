BEGIN;

CREATE TABLE character_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission text NOT NULL CHECK (permission IN ('VIEW', 'EDIT')),
    history_visible boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (character_id, user_id),
    CHECK (permission = 'VIEW' OR history_visible = false)
);
CREATE INDEX character_shares_user_idx ON character_shares(user_id);

CREATE FUNCTION protect_character_share() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    character_owner uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Share grants are immutable; revoke VIEW and grant again'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        -- Cascade on deletion of the original or recipient is allowed.
        IF OLD.permission = 'EDIT'
            AND EXISTS (SELECT 1 FROM characters WHERE id = OLD.character_id)
            AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
            RAISE EXCEPTION 'EDIT cannot be revoked' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    SELECT owner_id INTO character_owner FROM characters WHERE id = NEW.character_id;
    IF character_owner = NEW.user_id THEN
        RAISE EXCEPTION 'A character cannot be shared with its owner' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER character_shares_protected BEFORE INSERT OR UPDATE OR DELETE ON character_shares
    FOR EACH ROW EXECUTE FUNCTION protect_character_share();

COMMIT;
