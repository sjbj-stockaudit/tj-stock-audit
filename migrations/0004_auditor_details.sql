-- Extra auditor details collected via the auditor template
ALTER TABLE users ADD COLUMN home_area TEXT;
ALTER TABLE users ADD COLUMN id_proof TEXT; -- ID type + last 4 digits only, e.g. "Aadhaar ••••1234"
