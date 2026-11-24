ALTER TABLE competitions
  ADD COLUMN eligible_countries_json text NOT NULL DEFAULT '["NG"]';
--> statement-breakpoint
UPDATE competitions
  SET eligible_countries_json = '["' || upper(trim(country_code)) || '"]'
  WHERE country_code IS NOT NULL AND length(trim(country_code)) = 2;
