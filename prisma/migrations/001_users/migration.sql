BEGIN;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL CHECK (length(btrim(username)) > 0),
    email text NOT NULL CHECK (length(btrim(email)) > 0),
    password_hash text NOT NULL CHECK (length(btrim(password_hash)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auth normalizes email too; this index also protects direct database writes.
CREATE UNIQUE INDEX users_email_unique ON users (lower(btrim(email)));

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
