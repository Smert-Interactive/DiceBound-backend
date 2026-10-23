BEGIN;

CREATE TABLE game_systems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    source text NOT NULL CHECK (source IN ('BUILTIN', 'IMPORTED')),
    builtin_code text UNIQUE,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    description text,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT game_systems_origin_check CHECK (
        (source = 'BUILTIN' AND owner_id IS NULL AND builtin_code IS NOT NULL
            AND length(btrim(builtin_code)) > 0 AND deleted_at IS NULL)
        OR (source = 'IMPORTED' AND owner_id IS NOT NULL AND builtin_code IS NULL)
    )
);
CREATE INDEX game_systems_owner_idx ON game_systems(owner_id);

CREATE TABLE sheet_schemas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_system_id uuid NOT NULL REFERENCES game_systems(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    schema jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sheet_schemas_shape_check CHECK (
        jsonb_typeof(schema) = 'object' AND schema ? 'sections'
        AND jsonb_typeof(schema -> 'sections') = 'array'
    ),
    -- The next migration uses this key to bind characters to their system's schema.
    UNIQUE (id, game_system_id)
);
CREATE INDEX sheet_schemas_system_idx ON sheet_schemas(game_system_id);

CREATE TRIGGER game_systems_updated_at BEFORE UPDATE ON game_systems
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Inserted schemas are published. New revisions use new IDs.
CREATE FUNCTION protect_sheet_schema() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Published SheetSchema is immutable; create a new schema'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sheet_schemas_immutable BEFORE UPDATE ON sheet_schemas
    FOR EACH ROW EXECUTE FUNCTION protect_sheet_schema();

CREATE FUNCTION protect_game_system() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.source = 'BUILTIN' THEN
            RAISE EXCEPTION 'Built-in systems cannot be deleted' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW.source, NEW.owner_id, NEW.builtin_code)
        IS DISTINCT FROM (OLD.source, OLD.owner_id, OLD.builtin_code) THEN
        RAISE EXCEPTION 'System source and owner are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        RAISE EXCEPTION 'Deleted systems must be imported again with a new ID'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER game_systems_protected BEFORE UPDATE OR DELETE ON game_systems
    FOR EACH ROW EXECUTE FUNCTION protect_game_system();

COMMIT;
