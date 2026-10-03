/**
 * Wire types for the Rightis API.
 *
 * These mirror the server's response shapes field for field. Where the server
 * may add values later (permission scopes, presets), the type stays open with
 * `(string & {})` so a new value does not break your build.
 */

// ---------------------------------------------------------------------------
// Rights: Resolve contract (POST /api/public/v1/rights/resolve and
// POST /api/v1/rights/check)
// ---------------------------------------------------------------------------

/** The twelve permission scopes the public registry publishes today. */
export type KnownPermissionScope =
  | 'ai_image_generation'
  | 'ai_voice_generation'
  | 'ai_persona_chatbot'
  | 'ai_training_data'
  | 'social_media_ad'
  | 'brand_campaign'
  | 'product_detail_page'
  | 'shortform_ad'
  | 'video_ad'
  | 'game_avatar'
  | 'international_use'
  | 'derivative_work';

/** A permission scope. Open-ended: the registry can add scopes. */
export type PermissionScope = KnownPermissionScope | (string & {});

/**
 * One judgement, folded from every scope the described use touches.
 * The most restrictive scope wins: `denied > unspecified > requires_approval > allowed`.
 *
 * - `allowed`: the holder pre-authorised these scopes. **This is not free use.**
 *   A licence request inside these scopes is approved without the holder
 *   reviewing it, provided the fee clears their floor. You still request the
 *   licence; `next_action.type` is `request_license`.
 * - `requires_approval`: the holder decides each request. Terms Rightis could
 *   not map to a scope also land here.
 * - `unspecified`: the holder has said nothing about this scope. Not a yes.
 * - `denied`: the holder refuses at least one scope this use touches.
 */
export type Decision = 'allowed' | 'requires_approval' | 'unspecified' | 'denied';

/**
 * What to do next. There is deliberately no "proceed": every path that can
 * lead to use goes through a licence.
 */
export type NextActionType =
  /** Ask the holder for a licence. `url` points at the request page. */
  | 'request_license'
  /** Refused. Do not use. */
  | 'stop'
  /** Not in the registry. Not registered is not permission. */
  | 'not_registered'
  /** The person was found but no use was described. Describe the use to get a decision. */
  | 'describe_use';

export type AssetType = 'face' | 'voice' | 'style' | 'image';

/** The question you ask Rightis. Duration is not accepted: permissions carry no time dimension; the licence does. */
export interface ResolveInput {
  /** Rights ID, `BR-XXXX-XXXX-XXXX`. */
  rights_id: string;
  /** Free text, for example `"instagram ad"` or `"brand campaign"`. */
  use_type?: string | null;
  media_types?: readonly string[] | null;
  /** For example `image_generation`, `video_generation`, `voice_synthesis`, `style_transfer`. */
  ai_methods?: readonly string[] | null;
  /** ISO country codes. Outside the holder's country adds `international_use`. */
  territory?: readonly string[] | null;
  /** Which assets you intend to use. Not inferred when omitted, except that a non-voice AI method implies `face`. */
  asset_types?: readonly AssetType[] | null;
  /** Whether you intend to train on the identity. A separate right from generation. */
  for_training?: boolean | null;
}

export interface ResolveScopeDetail {
  scope: PermissionScope;
  state: Decision;
}

export interface ResolveIdentity {
  display_name: string;
  display_name_en: string | null;
  managed_by: string | null;
  identity_verified: boolean;
  country_code: string;
}

export interface NextAction {
  type: NextActionType;
  url: string | null;
  reason: string;
  /**
   * Whether a request would be approved without the holder reviewing it.
   * **Not a guarantee**: the fee floor, currency and restricted categories are
   * checked when you file the request, not here.
   */
  auto_approves?: boolean;
}

export interface ResolveResult {
  rights_id: string;
  registered: boolean;
  identity: ResolveIdentity | null;
  /** The judgement for the described use. `null` when no use was described or the ID is not registered. */
  decision: Decision | null;
  /** The per-scope states the decision was folded from. */
  scopes: ResolveScopeDetail[];
  /** Terms Rightis could not map to a scope. When non-empty, a person decides. */
  unmapped: string[];
  /** Training is answered separately: allowing generation does not allow training. */
  training: { decision: Decision; do_not_train: boolean };
  next_action: NextAction;
  /** A page a person can read. */
  profile_url: string | null;
  /** What this answer does not say. */
  notes: string[];
}

export type RightsCategoryName = 'face' | 'voice' | 'image' | 'style' | 'persona' | 'ip';

/**
 * Fields the keyed `/api/v1/rights/check` returned before it adopted the
 * Resolve contract. The server keeps sending them for a while.
 *
 * @deprecated Read `decision` and `next_action` instead. In particular do not
 * gate generation on `available_for_license`: it is not a permission.
 */
export interface LegacyCheckFields {
  /** @deprecated */
  rights_status?: 'available' | 'requires_approval' | 'restricted' | 'unknown';
  /** @deprecated */
  matched_entity?: {
    rights_id: string;
    display_name: string;
    managed_by: string | null;
    country_code: string | null;
    primary_language: string | null;
  } | null;
  /** @deprecated */
  matched_categories?: RightsCategoryName[];
  /** @deprecated */
  confidence_score?: number;
  /** @deprecated Not a permission. Use `decision` and `next_action`. */
  available_for_license?: boolean;
  /** @deprecated */
  requires_approval?: boolean;
  /** @deprecated */
  allowed_usage?: string[];
  /** @deprecated */
  restricted_categories?: string[];
  /** @deprecated */
  persona_available?: boolean;
  /** @deprecated */
  persona_usage_terms_summary?: string | null;
  /** @deprecated */
  estimated_fee_range?: { min: string; max: string; currency: string } | null;
  /** @deprecated */
  license_request_url?: string | null;
  /** @deprecated */
  safe_alternatives_url?: string | null;
  /** @deprecated */
  disclaimer?: string;
  /** @deprecated */
  face_matches?: Array<{ rights_id: string; display_name: string | null; listed: boolean; similarity: number }>;
}

/** Input to `rights.check`. The Resolve fields, plus legacy fields the keyed endpoint still accepts. */
export interface RightsCheckInput extends ResolveInput {
  /** @deprecated Keyed endpoint only. Use `use_type`. */
  usage_type?: string;
  /** @deprecated Keyed endpoint only. Use `media_types`. */
  media_type?: string;
  /** @deprecated Keyed endpoint only. Use `asset_types`. */
  requested_categories?: RightsCategoryName[];
  /** @deprecated Keyed endpoint only. Not answered: permissions carry no time dimension. */
  duration_days?: number;
  /** @deprecated Keyed endpoint only. */
  brand_category?: string;
}

/** The answer to `rights.check`. Same shape on the keyed and the public path. */
export type RightsCheckResult = ResolveResult & LegacyCheckFields;

// ---------------------------------------------------------------------------
// Rights: lookup and search (keyless)
// ---------------------------------------------------------------------------

export interface PublicRightsView {
  registered: true;
  rights_id: string;
  display_name: string;
  display_name_en: string | null;
  managed_by: string | null;
  avatar_url: string | null;
  country_code: string;
  registered_at: string;
  /** Scopes the holder pre-authorised. A licence request inside these is approved without review. Still not free use. */
  allowed: PermissionScope[];
  requires_approval: PermissionScope[];
  denied: PermissionScope[];
  do_not_train: boolean;
  accepts_requests: boolean;
  identity_verified: boolean;
  assets: { face: boolean; voice: boolean; artwork: boolean; persona: boolean };
  profile_url: string;
  license_request_url: string;
  lookup_url: string;
}

export interface PublicRightsNotFound {
  registered: false;
  rights_id: string;
  message: string;
  register_url: string;
}

export type RightsLookupResult = PublicRightsView | PublicRightsNotFound;

export interface RightsSearchResult {
  query: string;
  count: number;
  data: PublicRightsView[];
}

// ---------------------------------------------------------------------------
// Licences
// ---------------------------------------------------------------------------

export type AiGenerationMethod =
  | 'none'
  | 'image_generation'
  | 'voice_generation'
  | 'video_generation'
  | 'style_transfer'
  | 'deepfake_replacement'
  | 'composite'
  | 'other';

export type RestrictionCategory =
  | 'adult_content'
  | 'political_content'
  | 'gambling'
  | 'alcohol_tobacco'
  | 'medical_cosmetic_ad'
  | 'finance_investment_ad'
  | 'religion_ideology'
  | 'defamation_satire'
  | 'hate_discrimination'
  | 'illegal_goods'
  | 'identity_damaging'
  | 'other';

/** Body of `POST /api/v1/licenses/requests` (scope `license:request`). */
export interface LicenseRequestInput {
  rights_id: string;
  campaign_name: string;
  description: string;
  usage_type: string;
  media_types: string[];
  territory: string[];
  /** ISO 8601 with offset. */
  duration_start: string;
  /** ISO 8601 with offset. */
  duration_end: string;
  rights_categories: AssetType[];
  ai_generation_methods: AiGenerationMethod[];
  /** Decimal as a string, for example `"500000"` or `"1200.50"`. Never a number. */
  proposed_fee: string;
  /** ISO 4217, for example `KRW`. */
  currency_code: string;
  pricing_model?: 'flat' | 'metered';
  proposed_unit_price?: string;
  proposed_included_units?: number;
  restricted_categories_flagged?: RestrictionCategory[];
  reference_url?: string | null;
}

export interface LicenseRequestView {
  license_request_id: string;
  service_id: string | null;
  status: string;
  auto_approved: boolean;
  approval_method: 'manual' | 'auto_preauthorized' | null;
  created_at: string;
  responded_at: string | null;
  license: {
    public_code: string;
    status: string;
    effective_start: string;
    effective_end: string;
    snapshot_url: string;
    assets_url: string;
    confirm_url: string;
  } | null;
  hosted_approval_url: string;
  webhook_events_to_expect: string[];
}

/** Body of `POST /api/v1/licenses/verify` (scope `license:verify`). Give at least one field. */
export interface LicenseVerifyInput {
  license_id?: string;
  license_public_code?: string;
  content_hash?: string;
}

export interface LicenseVerifyResult {
  valid: boolean;
  license_status: 'active' | 'expired' | 'revoked' | 'unknown';
  license_public_code: string | null;
  rights_holder_display_name: string | null;
  brand_display_name: string | null;
  territory: string[];
  valid_from: string | null;
  valid_until: string | null;
  media_types: string[];
  rights_categories: RightsCategoryName[];
  proof_url: string | null;
  revoked: boolean;
  /** `null`: no proof yet. `false`: the stored proof failed its signature check, and `valid` is forced false. */
  proof_signature_valid: boolean | null;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export type UsageType = 'generation' | 'exposure' | 'inference' | 'voice_synthesis' | 'training' | 'other';
export type UsageDecision = 'allow' | 'block' | 'fallback';

export interface UsageEvent {
  /** Your idempotency key, unique per developer app. Resending the same id is reported as `duplicate`. */
  event_id: string;
  /** `L-...` (asset licence) or `PL-...` (persona licence). Usage is recorded only against a licence. */
  license_public_code: string;
  /** ISO 8601 with offset. */
  occurred_at: string;
  use_type: UsageType;
  decision: UsageDecision;
  channel?: string;
  rights_categories?: RightsCategoryName[];
  reason_code?: string;
  policy_version?: number;
  content_hash?: string;
  generation_tool?: string;
  generation_tool_version?: string;
  output_license_ref?: string;
  /** At most 4 KB. Never personal data. */
  metadata?: Record<string, unknown>;
}

export interface UsageBatchResult {
  received: number;
  recorded: number;
  duplicates: number;
  rejected: number;
  results: Array<{ event_id: string; outcome: 'recorded' | 'duplicate' | 'rejected'; reason?: string }>;
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export interface SandboxPerson {
  rights_id: string;
  display_name: string;
  /** For example `fully_approved`, `approval_required`, `commercial_use_denied`. */
  preset: string;
  summary: string;
}

export interface SandboxPeopleResult {
  people: SandboxPerson[];
}

// ---------------------------------------------------------------------------
// Console (OAuth access token, scope console:manage)
// ---------------------------------------------------------------------------

export type ApiEnvironment = 'sandbox' | 'production';

export type ConsoleUseCase = 'generation_gate' | 'persona_product' | 'verification' | 'research' | 'other';

export interface ConsoleKey {
  id: string;
  key_id_public: string;
  environment: ApiEnvironment;
  status: string;
  scopes: string[];
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ConsoleOverview {
  organization: { id: string; name: string; status: string } | null;
  apps: Array<{ id: string; environment: ApiEnvironment; name: string; status: string }>;
  production_unlocked: boolean;
  keys: ConsoleKey[];
}

export interface ConsoleSetupInput {
  organization_name: string;
  use_case: ConsoleUseCase;
  website_url?: string;
}

export interface ConsoleSetupResult {
  organization_id: string;
  created: boolean;
}

export interface ConsoleCreateKeyInput {
  environment: ApiEnvironment;
  scopes?: string[];
  label?: string;
}

export interface ConsoleCreateKeyResult {
  key: ConsoleKey;
  /** The full API key. Shown once. Store it; never log it. */
  secret: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** The body Rightis POSTs to your endpoint. Use `event_id` for idempotency. */
export interface WebhookEvent<T = unknown> {
  event_id: string;
  event_type: string;
  created_at: string;
  data: T;
}
