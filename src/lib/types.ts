import type { FacilityRating, PhotoKind, Role, TractorStatus, VisitStatus } from '../../shared/domain';

export type Me = { id: number; username: string; name: string; role: Role; selfie_required?: boolean };

export type User = {
  id: number;
  username: string;
  name: string;
  phone: string | null;
  role: Role;
  home_area: string | null;
  id_proof: string | null;
  active: number;
  created_at: string;
};

export type Centre = {
  id: number;
  state: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  active: number;
  last_audit: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  opening_hours: string | null;
  weekly_off: string | null;
};

export type VisitRow = {
  id: number;
  audit_date: string;
  status: VisitStatus;
  outcome: 'not_done' | null;
  outcome_reason: string | null;
  checkin_at: string | null;
  checkout_at: string | null;
  submitted_at: string | null;
  checkin_distance_m: number | null;
  centre_id: number;
  centre_name: string;
  state: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  auditor_id: number | null;
  auditor_name: string | null;
  inventory_count: number;
  pending_count: number;
  verified_count: number;
  mismatch_count: number;
  not_found_count: number;
  extra_count: number;
};

export type Tractor = {
  id: number;
  visit_id: number;
  source: 'inventory' | 'extra';
  reg_no: string | null;
  engine_no: string | null;
  chassis_no: string | null;
  verified_reg: string | null;
  verified_chassis: string | null;
  status: TractorStatus;
  remarks: string | null;
  seen_engine?: string | null;
  meter_reading?: number | null;
  meter_unit?: 'km' | 'hours' | null;
  location_id?: number | null;
  seen_at?: string | null;
  related_id?: number | null;
  related_reason?: 'near_chassis' | 'same_plate' | null;
  retyped?: number | null;
  prev_meter?: number | null;
  prev_meter_unit?: string | null;
  prev_date?: string | null;
  prev_centre?: string | null;
  meter_diff?: number | null;
  meter_flag?: 'moved' | 'went_down' | 'unit_changed' | null;
  office_remarks?: string | null;
};

/** What an auditor sees of a tractor they recorded (the stock list itself stays hidden). */
export type SeenTractor = {
  id: number;
  reg_no: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  meter_reading: number | null;
  meter_unit: 'km' | 'hours' | null;
  location_id: number | null;
  seen_at: string | null;
  remarks?: string | null;
};

/** A supporting-document photo: an "other" photo not linked to a tractor, accessory, facility area or place. */
export const isDocumentPhoto = (p: Photo) => p.kind === 'other' && !p.tractor_id && !p.accessory_id && !p.facility_id && !p.location_id;

export type VisitLocation = {
  id: number;
  name: string;
  kind: string | null;
  address: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_m: number | null;
  arrived_at: string;
};

export type Accessory = { id: number; visit_id: number; name: string; qty: number; remarks: string | null };

export type Photo = {
  id: number;
  tractor_id: number | null;
  accessory_id: number | null;
  facility_id: number | null;
  location_id?: number | null;
  kind: PhotoKind;
  lat: number | null;
  lng: number | null;
  taken_at: string;
};

export type VisitDetail = {
  visit: VisitRow & {
    address: string | null;
    radius_m: number;
    auditor_phone: string | null;
    checkin_lat: number | null;
    checkin_lng: number | null;
    checkout_lat: number | null;
    checkout_lng: number | null;
    manager_name: string | null;
    general_remarks: string | null;
    review_note: string | null;
    reviewed_at: string | null;
    reviewer_name: string | null;
    has_auditor_signature: boolean;
    has_manager_signature: boolean;
    has_checkin_selfie: boolean;
    centre_manager: string | null;
    centre_manager_phone: string | null;
    opening_hours: string | null;
    weekly_off: string | null;
    count_done_at?: string | null;
    pending_at_count?: number | null;
    missing_explanation?: string | null;
    manager_phone?: string | null;
    same_day_open?: boolean;
    office_remarks?: string | null;
    extended_on?: string | null;
  };
  tractors: Tractor[];
  locations: VisitLocation[];
  accessories: Accessory[];
  photos: Photo[];
  pings: { lat: number; lng: number; accuracy: number | null; at: string }[];
  facility: FacilityCheck[];
};

export type FacilityCheck = { id: number; area: string; sort_order: number; is_custom: number; rating: FacilityRating | null; remarks: string | null };

export type Settings = { firm_name: string; client_name: string };
