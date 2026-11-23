-- Madhya Pradesh centres from MP_Centers_List.xlsx. Coordinates are filled in later
-- (from the admin Centres page, or automatically from the first auditor check-in).
INSERT INTO centres (state, name, address) VALUES
  ('MP', 'Ujjain', 'A-2 Sharda Homes, infront of Maharishi Sandipani School, MR-5 Road (Maxi road)'),
  ('MP', 'Dewas', 'Infront of IOCL fuel pump Bilawali Maksi by pass road Dewas MP - 455001'),
  ('MP', 'Jabalpur', 'Katangi Bypass Road, Opposite Anmol Parishar, Dist- Jabalpur, Madhya Pradesh'),
  ('MP', 'Chhindwara', 'Near Revolt Showroom, Nagpur Road, ChandanGaon tehsil'),
  ('MP', 'Betul', 'Betul Bazaar Road / BhramaKumari marg, Batama Tehsil'),
  ('MP', 'Mandsaur', 'Mhow Neemuch Marg, Bhunyakhedi, Madhya Pradesh 458001'),
  ('MP', 'Seoni', 'Tractor Junction Showroom, Opposite International Public school, Jabalpur road, loogharwada, Seoni, Madhya Pradesh'),
  ('MP', 'Shivpuri', 'Fatehpur Bypass Shivpuri Tehsil'),
  ('MP', 'Neemuch', 'Tractor Junction showroom Mahow Neemuch road Neemuch MP 458441'),
  ('MP', 'Damoh', 'Choupra Khurd, Damoh, Aam Choumpra, Madhya Pradesh 470661'),
  ('MP', 'Mandla', 'Tractor Junction Showroom, Opposite Maa Narmada Mridukishore Valley, Katra, Gonjhi Ryt., Madhya Pradesh 481661'),
  ('MP', 'Agar', 'Agar city in front of messay showrooom Agar Malwa'),
  ('MP', 'Chhatarpur', 'sagar road Chhatarpur'),
  ('MP', 'Pachore', 'In Front of SK Finance Office Pachore'),
  ('MP', 'Nasrullaganj', 'in front of sarv manglam garden indore road bherunda nasrullaganj'),
  ('MP', 'Vidisha', 'Plot no 4, ward no 44, mirzapur main road, vidisha, new galla mandi road, near chouksey warehouse, Vidisha'),
  ('MP', 'Ashok Nagar', 'Tractor Junction Guna Road Near M&M showroom Ashoknagar Pin code 473331'),
  ('MP', 'Ashta', 'Tractor Junction Bhopal Road In front of Sani Temple Ashta MP'),
  ('MP', 'Pipariya', 'TRACTOR JUNCTION Near Bajaj showroom ShobhaPur road Hathwas, PIPARIYA'),
  ('MP', 'Khategaon', 'Vrindavan colony ke pass, nemawar, khategaon'),
  ('MP', 'Khachrod', 'Ward No.21, Mohalla Nagda Road Main Marg Gopal Mandir se Shivani Resort ke Beech Khachrod'),
  ('MP', 'Gotegaon', 'Near Prakhar garden, Kumda kheda, Gotegaon'),
  ('MP', 'Guna', 'near Rishbh Motors, Shahpur, Guna, Madhya Pradesh 473001'),
  ('MP', 'Luvkush Nagar', 'chhatarpur rod lavkush nagar. Pin code : 471515');

-- Spellings seen in the client's stock statement
INSERT INTO centre_aliases (alias, centre_id) SELECT 'vidhisha', id FROM centres WHERE name = 'Vidisha';
INSERT INTO centre_aliases (alias, centre_id) SELECT 'ashoknagar', id FROM centres WHERE name = 'Ashok Nagar';
INSERT INTO centre_aliases (alias, centre_id) SELECT 'lavkushnagar', id FROM centres WHERE name = 'Luvkush Nagar';

-- Known Damoh coordinates from the 23/11/2026 GPS-stamped report
UPDATE centres SET lat = 23.800827, lng = 79.454768 WHERE name = 'Damoh';
