-- Office exception: an audit may continue on one more day (date in India time), recorded on the audit
ALTER TABLE visits ADD COLUMN extended_on TEXT;
