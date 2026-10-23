BEGIN;

CREATE TABLE characters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    game_system_id uuid NOT NULL REFERENCES game_systems(id) ON DELETE RESTRICT,
    sheet_schema_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
    source_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
    source_owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
    source_owner_username text,
    copied_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (sheet_schema_id, game_system_id)
        REFERENCES sheet_schemas(id, game_system_id) ON DELETE RESTRICT,
    CONSTRAINT characters_copy_check CHECK (
        (copied_at IS NULL AND source_character_id IS NULL
            AND source_owner_id IS NULL AND source_owner_username IS NULL)
        OR (copied_at IS NOT NULL AND source_owner_username IS NOT NULL
            AND length(btrim(source_owner_username)) > 0)
    ),
    CHECK (source_character_id IS NULL OR source_character_id <> id),
    CHECK (source_owner_id IS NULL OR source_owner_id <> owner_id)
);
CREATE INDEX characters_owner_idx ON characters(owner_id);
CREATE INDEX characters_system_idx ON characters(game_system_id);
CREATE INDEX characters_schema_idx ON characters(sheet_schema_id, game_system_id);
CREATE INDEX characters_source_idx ON characters(source_character_id);
CREATE INDEX characters_source_owner_idx ON characters(source_owner_id);

CREATE TABLE character_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    version_number integer NOT NULL CHECK (version_number >= 1),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (character_id, version_number)
);

CREATE TRIGGER characters_updated_at BEFORE UPDATE ON characters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION protect_character_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'CharacterVersion snapshots are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER character_versions_immutable BEFORE UPDATE ON character_versions
    FOR EACH ROW EXECUTE FUNCTION protect_character_version();

CREATE FUNCTION protect_character_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    selected_system game_systems%ROWTYPE;
    original characters%ROWTYPE;
    original_username text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.owner_id, NEW.game_system_id, NEW.sheet_schema_id)
            IS DISTINCT FROM (OLD.owner_id, OLD.game_system_id, OLD.sheet_schema_id) THEN
            RAISE EXCEPTION 'Character owner and schema binding are immutable'
                USING ERRCODE = '23514';
        END IF;
        IF (NEW.copied_at, NEW.source_owner_username)
            IS DISTINCT FROM (OLD.copied_at, OLD.source_owner_username) THEN
            RAISE EXCEPTION 'Copy provenance is immutable' USING ERRCODE = '23514';
        END IF;
        IF NEW.source_character_id IS DISTINCT FROM OLD.source_character_id
            AND NOT (NEW.source_character_id IS NULL AND OLD.source_character_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM characters WHERE id = OLD.source_character_id)) THEN
            RAISE EXCEPTION 'Copy original reference is immutable' USING ERRCODE = '23514';
        END IF;
        IF NEW.source_owner_id IS DISTINCT FROM OLD.source_owner_id
            AND NOT (NEW.source_owner_id IS NULL AND OLD.source_owner_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.source_owner_id)) THEN
            RAISE EXCEPTION 'Copy original owner reference is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.copied_at IS NOT NULL THEN
        SELECT * INTO original FROM characters WHERE id = NEW.source_character_id FOR SHARE;
        SELECT username INTO original_username FROM users WHERE id = original.owner_id;
        IF original.id IS NULL OR NEW.owner_id = original.owner_id
            OR NEW.game_system_id <> original.game_system_id
            OR NEW.sheet_schema_id <> original.sheet_schema_id
            OR NEW.source_owner_id IS DISTINCT FROM original.owner_id
            OR NEW.source_owner_username IS DISTINCT FROM original_username THEN
            RAISE EXCEPTION 'Copy must retain the original system, schema and provenance'
                USING ERRCODE = '23514';
        END IF;
        -- Copies of existing characters remain possible after system removal.
        RETURN NEW;
    END IF;

    SELECT * INTO selected_system FROM game_systems WHERE id = NEW.game_system_id FOR SHARE;
    IF selected_system.deleted_at IS NOT NULL
        OR (selected_system.source = 'IMPORTED' AND selected_system.owner_id <> NEW.owner_id) THEN
        RAISE EXCEPTION 'System is unavailable for new characters' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER characters_binding BEFORE INSERT OR UPDATE ON characters
    FOR EACH ROW EXECUTE FUNCTION protect_character_binding();

COMMIT;
