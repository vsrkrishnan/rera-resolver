// Labeled evaluation set for the §8 measurement gate. Every case here comes
// from real queries (either tried during development, 2026-07-17/18, or
// verified directly against a live-synced index snapshot on 2026-07-18), not
// fabricated examples — see each case's `provenance` for exactly how the
// label was verified, and `confidence` for how strong that verification
// actually is. Still below the spec's "a few dozen minimum" — growing it
// further requires more real queries with real verified outcomes, not
// synthetic padding.

export type EvalConfidence = 'confirmed' | 'high_confidence_inferred' | 'unconfirmed';
export type EvalCategory = 'typo' | 'master_community' | 'brand_prefix' | 'phased_project' | 'pre_rera_absence';

export interface EvalCase {
  query: string;
  category: EvalCategory;
  wellKnown: boolean;
  provenance: string;
  confidence: EvalConfidence;
  // Exactly one of these two is set.
  acceptedRegNumbers?: string[]; // any one of these counts as correct — genuinely multi-answer queries
  // The project is confirmed/inferred absent from the registry. The bar this
  // measures is NOT "must return status: unresolved" — a query that shares a
  // real brand token with other real same-developer projects can legitimately
  // come back 'ambiguous' with weak, appropriately-hedged candidates, and
  // that's honest behavior, not a failure (learned the hard way: every case
  // below was already 'ambiguous', never 'unresolved', from the very first
  // test run, long before any matcher changes — mislabeling this as
  // expectUnresolved would have reported a false regression). The bar that
  // actually matters is that it never reaches 'high_confidence' — i.e. never
  // falsely asserts a specific confident match for a project that isn't
  // really there.
  expectNotHighConfidence?: true;
}

export const EVAL_SET: EvalCase[] = [
  {
    query: 'Godraj United',
    category: 'typo',
    wellKnown: true,
    acceptedRegNumbers: ['PRM/KA/RERA/1251/446/PR/171010/000003'],
    provenance:
      "User-supplied test query, a typo of 'Godrej United'. Verified live: the real project 'Godrej United' (promoter United Oxygen Company Private Limited) is the sole plausible match in the live index — no other real Godrej-branded project with 'United' in the name exists.",
    confidence: 'confirmed',
  },
  {
    query: 'Nambiar District 25',
    category: 'phased_project',
    wellKnown: false,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/308/PR/200825/008011', // Phase 2
      'PRM/KA/RERA/1251/308/PR/260526/008686', // Phase 3
      'PRM/KA/RERA/1251/308/PR/100125/007377', // Phase 1
    ],
    provenance:
      'User-supplied test query. Verified live: exactly 3 real phases exist under promoter Nambiar EnsembleResidential Projects LLP. The query names no specific phase, so this is genuinely multi-answer — recall@1 is not a meaningful pass/fail here (there is no single "correct" top pick), only "is a real phase surfaced at all."',
    confidence: 'confirmed',
  },
  {
    query: 'Prestige city',
    category: 'master_community',
    wellKnown: true,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/308/PR/180326/008537', // Eaton Park
      'PRM/KA/RERA/1251/308/PR/110326/008519', // Fernvale
      'PRM/KA/RERA/1251/308/PR/080323/005778', // Aston Park
      'PRM/KA/RERA/1251/308/PR/110822/005151', // Meridian Park Phase III
      'PRM/KA/RERA/1251/308/PR/230522/004901', // Meridian Park Phase II
      'PRM/KA/RERA/1251/308/PR/090222/004684', // Meridian Park Phase I
      'PRM/KA/RERA/1251/308/PR/211007/004346', // Aspen Greens
      'PRM/KA/RERA/1251/308/PR/211008/004353', // Eden Park
      'PRM/KA/RERA/1251/308/PR/210928/004316', // The Prestige City - Avalon Park
    ],
    provenance:
      'User-supplied test query. Verified live: 9 real sub-projects registered as "<Tower> @ The Prestige City". Genuinely multi-answer for the same reason as Nambiar District 25. Note: "Prestige Jindal City-Phase II" (a real, different project) legitimately ties with these 9 on pure token containment — not an error, a documented structural limit of Tier 2.',
    confidence: 'confirmed',
  },
  {
    query: 'Brigade El Dorado',
    category: 'master_community',
    wellKnown: true,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/309/PR/160524/006878', // Cobalt
      'PRM/KA/RERA/1251/309/PR/160224/006634', // Dioro & Beryl
      'PRM/KA/RERA/1250/303/PR/230623/006018', // Aurum
      'PRM/KA/RERA/1251/309/PR/190722/005089', // Emerald & Luminaire
      'PRM/KA/RERA/1251/309/PR/210216/003909', // Feldspar
      'PRM/KA/RERA/1250/303/PR/200618/003458', // Jasper and Iridium
      'PRM/KA/RERA/1251/472/PR/190913/002889', // Helio
      'PRM/KA/RERA/1251/472/PR/190427/002540', // Gallium
    ],
    provenance:
      'Follow-up test query after the Prestige City finding, to check the same naming pattern elsewhere. Verified live: 8 real sub-towers under promoter Brigade Tetrarch Private Limited. Multi-answer, same reasoning as above.',
    confidence: 'confirmed',
  },
  {
    query: 'Keerthi',
    category: 'brand_prefix',
    wellKnown: false,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/446/PR/210302/003989', // SBR KeerthiPrime
      'PRM/KA/RERA/1251/446/PR/190129/002309', // SBR Keerthi
      'PRM/KA/RERA/1251/310/PR/171031/001598', // Keerthi Royal Palms Phase I
      'PRM/KA/RERA/1251/446/PR/171031/001600', // Keerthi Krishna Viva
      'PRM/KA/RERA/1251/446/PR/171103/001596', // Keerthi Surya Sakthi Towers Block A
      'PRM/KA/RERA/1251/446/PR/171214/001529', // Keerthi Regalia
      'PRM/KA/RERA/1251/446/PR/171031/001465', // Keerthi Splendour
      'PRM/KA/RERA/1251/446/PR/170326/008533', // Keerthi Nandini The Ascent
    ],
    provenance:
      'User-supplied deliberately vague single-word test query. Verified live: 8 real Keerthi-branded projects. Extremely ambiguous by design (a single brand word, no way to identify one specific project) — this case is really testing "does the matcher surface the real universe of matches," not recall@1.',
    confidence: 'confirmed',
  },
  {
    query: 'gopalan aristocrat',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      "REKI's own eval-run data (backend/eval-runs/2026-07-16-13-03-gopalan-aristocrat/06-rera.md) shows this project completed Oct 2012 — 5 years before Karnataka RERA's 2017 enactment. Independently cross-checked: a RERA number cited by a third-party web source (magicbricks) for this project does not exist anywhere in the real registry, confirming the project itself was never registered (not just missed by this library's index).",
    confidence: 'confirmed',
  },
  {
    query: 'Purva Seasons',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      "User was confident this should be findable. Verified absent from the live index under any Purva/Seasons token combination. Inferred pre-RERA: Puravankara's earliest registered project in the live index dates to Sept 2017 (RERA's launch month) — no Puravankara project predates that, consistent with this one having completed before RERA existed. NOT independently confirmed via an external completion-date source the way Gopalan Aristocrat was.",
    confidence: 'high_confidence_inferred',
  },
  {
    query: 'Total Environment Raindrops falling on my head',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      "Verified absent from the live index. Total Environment has 23 other real projects registered, all dated Oct 2017 or later, none matching this name. Consistent with pre-RERA absence (same reasoning pattern as Purva Seasons) but not independently confirmed.",
    confidence: 'high_confidence_inferred',
  },
  {
    query: 'Brigade Gateway',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      "Verified absent from the live index. Brigade Enterprises Ltd has 60 other real projects registered, all dated 2017 or later, none named 'Gateway'. Consistent with pre-RERA absence but not independently confirmed.",
    confidence: 'high_confidence_inferred',
  },
  {
    query: 'Samhita Square',
    category: 'pre_rera_absence',
    wellKnown: false,
    expectNotHighConfidence: true,
    provenance:
      'Verified absent from the live index. Samhita Estates LLP/Samhita Constructions has 5 other real registered projects, so the developer is genuinely active in RERA, but none named "Square". Reason for absence NOT confirmed — could be pre-RERA, could be a naming mismatch this library cannot bridge without Tier 3. Weakest-verified negative case in this set.',
    confidence: 'unconfirmed',
  },
  {
    query: 'Ashoka Windows',
    category: 'pre_rera_absence',
    wellKnown: false,
    expectNotHighConfidence: true,
    provenance:
      'Verified absent from the live index. "Ashoka" appears in 8 unrelated real projects; none is a plausible match for "Ashoka Windows". Reason for absence not confirmed.',
    confidence: 'unconfirmed',
  },

  // Added 2026-07-18: verified directly against a live-synced index snapshot
  // (data/index.db, fetchedAt 2026-07-18T04:24:36.957Z) via direct SQL query,
  // not the resolve() API — same "real, checkable outcome" bar as the set
  // above, just checked by a different, equally authoritative route.
  {
    query: 'Purva Meraky',
    category: 'typo',
    wellKnown: false,
    acceptedRegNumbers: ['PRM/KA/RERA/1251/310/PR/071022/005307'],
    provenance:
      "Deliberate typo of the real project 'Purva Meraki' (promoter Puravankara Limited). Verified live: sole matching project in the index under either spelling.",
    confidence: 'confirmed',
  },
  {
    query: 'Sobha Alter',
    category: 'typo',
    wellKnown: true,
    acceptedRegNumbers: ['PRM/KA/RERA/1251/446/PR/070126/008388'],
    provenance:
      "Deliberate typo of the real project 'Sobha Altair' (promoter Sobha Limited). Verified live: sole real Sobha project named Altair in the index.",
    confidence: 'confirmed',
  },
  {
    query: 'Sobha Crystal Meadows',
    category: 'phased_project',
    wellKnown: true,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/446/PR/280324/006733', // Phase 1, Wing 1 to 6
      'PRM/KA/RERA/1251/446/PR/280324/006734', // Phase 2, Wing 7 and 8
      'PRM/KA/RERA/1251/446/PR/280324/006735', // Phase 3, Wing 9 to 15
      'PRM/KA/RERA/1251/446/PR/280324/006736', // Phase 4, Wing 23 to 28
      'PRM/KA/RERA/1251/446/PR/280324/006737', // Phase 5, Wing 16 to 22
    ],
    provenance:
      'Verified live: exactly 5 real phases registered under Sobha Limited. The query names no specific phase/wing, so this is genuinely multi-answer — same reasoning as Nambiar District 25: recall@1 is not meaningful here, only whether a real phase is surfaced at all.',
    confidence: 'confirmed',
  },
  {
    query: 'Sobha Dream Acres',
    category: 'master_community',
    wellKnown: true,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/446/PR/170915/000193', // Rain forest Phase 1
      'PRM/KA/RERA/1251/446/PR/170915/000157', // Rain Forest Phase 2
      'PRM/KA/RERA/1251/446/PR/170915/000221', // Rain Forest Phase 3
      'PRM/KA/RERA/1251/446/PR/170915/000156', // Rain Forest Phase 4
      'PRM/KA/RERA/1251/446/PR/170915/000223', // Rain Forest Phase 5
      'PRM/KA/RERA/1251/446/PR/170915/000165', // Tropical Greens Phase 6
      'PRM/KA/RERA/1251/446/PR/170915/000202', // Tropical Greens Phase 7
      'PRM/KA/RERA/1251/446/PR/170915/000195', // Tropical Greens Phase 8
      'PRM/KA/RERA/1251/446/PR/170915/000163', // Tropical Greens Phase 9
      'PRM/KA/RERA/1251/446/PR/170915/000206', // Tropical Greens Phase 10
      'PRM/KA/RERA/1251/446/PR/170915/000207', // Palm Springs Phase 11
      'PRM/KA/RERA/1251/446/PR/170915/000168', // Palm Springs Phase 12
      'PRM/KA/RERA/1251/310/PR/170915/000170', // Palm Springs Phase 13
      'PRM/KA/RERA/1251/446/PR/170915/000160', // Palm Springs Phase 14
      'PRM/KA/RERA/1251/446/PR/170916/000293', // Rain forest Phase 15
      'PRM/KA/RERA/1251/446/PR/190913/002845', // Palm Springs Phase 16
      'PRM/KA/RERA/1251/446/PR/171031/001452', // Palm Springs Phase 17
      'PRM/KA/RERA/1251/446/PR/171031/001467', // Tropical Greens Phase 18
      'PRM/KA/RERA/1251/446/PR/180612/001897', // Tropical Greens Phase 19
      'PRM/KA/RERA/1251/446/PR/180627/001929', // Tropical Greens Phase 20
      'PRM/KA/RERA/1251/446/PR/181010/002036', // Tropical Greens Phase 21
      'PRM/KA/RERA/1251/446/PR/181010/002037', // Tropical Greens Phase 22
      'PRM/KA/RERA/1251/446/PR/181010/002038', // Tropical Greens Phase 23
      'PRM/KA/RERA/1251/446/PR/181010/002039', // Tropical Greens Phase 24
      'PRM/KA/RERA/1251/446/PR/190223/002449', // Tropical Greens Phase 25
      'PRM/KA/RERA/1251/446/PR/190223/002448', // Tropical Greens Phase 26
      'PRM/KA/RERA/1251/446/PR/200121/003218', // Oasis Phase 27
    ],
    provenance:
      'Verified live: 27 real sub-community/phase entries registered as "Sobha Dream Acres - <Cluster> Phase N Wing M" (Rain Forest / Tropical Greens / Palm Springs / Oasis clusters), all under Sobha Limited. Same master-community naming pattern as Prestige City and Brigade El Dorado — genuinely multi-answer, not a recall@1 case.',
    confidence: 'confirmed',
  },
  {
    query: 'Purva',
    category: 'brand_prefix',
    wellKnown: false,
    acceptedRegNumbers: [
      'PRM/KA/RERA/1251/472/PR/190204/002350', // Purva Atmosphere
      'PRM/KA/RERA/1251/310/PR/290323/005829', // Purva Blubelle
      'PRM/KA/RERA/1251/310/PR/170916/000235', // Purva Coronation Square
      'PRM/KA/RERA/1251/310/PR/071022/005307', // Purva Meraki
      'PRM/KA/RERA/1251/446/PR/150323/005796', // Purva Oakshire
      'PRM/KA/RERA/1251/310/PR/210907/004299', // Purva Orient Grand
      'PRM/KA/RERA/1251/446/PR/170907/000091', // Purva Palmbeach
      'PRM/KA/RERA/1251/310/PR/220601/004946', // Purva Park Hill (Wing A)
      'PRM/KA/RERA/1251/310/PR/220601/004947', // Purva Park Hill (Wing B)
      'PRM/KA/RERA/1251/310/PR/220601/004948', // Purva Park Hill (Wing C)
      'PRM/KA/RERA/1251/310/PR/220601/004949', // Purva Park Hill (Wing D)
      'PRM/KA/RERA/1251/446/PR/200205/003243', // Purva Promenade
      'PRM/KA/RERA/1251/310/PR/151225/008338', // Purva Silversky
      'PRM/KA/RERA/1251/310/PR/171015/000403', // Purva Sunflower
      'PRM/KA/RERA/1251/310/PR/170915/000394', // Purva Westend Phase 1
      'PRM/KA/RERA/1251/309/PR/190129/002311', // Purva Zenium 1
    ],
    provenance:
      'User-supplied-style deliberately vague single-word test query. Verified live: 16 real "Purva"-branded projects under Puravankara Limited (excluding the distinct "Provident" sub-brand it also uses). Extremely ambiguous by design, same reasoning as the Keerthi case — tests whether the matcher surfaces the real universe of matches, not recall@1.',
    confidence: 'confirmed',
  },
  {
    query: 'UB City',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      "Verified absent from the live index: no registeredName or promoterName entry (including Prestige Estates Projects Ltd's 30+ other real registered entries, confirming it's active in RERA) contains 'UB' or plausibly matches this project. Independently confirmed via Wikipedia: UB City, a Prestige Group/UB Group joint venture, was completed in 2008 — nine years before Karnataka RERA's 2017 enactment.",
    confidence: 'confirmed',
  },
  {
    query: 'Brigade Gardenia',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      'Verified absent from the live index: none of the 40+ real "Gardenia"-named entries in the index belong to Brigade — all belong to unrelated developers. Brigade Enterprises Ltd is confirmed active in RERA via its 45+ other real registered entries. Independently confirmed via Brigade Group\'s own site: Brigade Gardenia (JP Nagar) was completed/delivered in 2009, before RERA\'s 2017 enactment.',
    confidence: 'confirmed',
  },
  {
    query: 'Brigade Metropolis',
    category: 'pre_rera_absence',
    wellKnown: true,
    expectNotHighConfidence: true,
    provenance:
      'Verified absent from the live index: the handful of "Metropolis"-named entries in the index belong to an unrelated developer (Metropolis Properties Private Limited), none to Brigade. Brigade Enterprises Ltd is confirmed active in RERA via its 45+ other real registered entries. Independently corroborated via multiple listings (CommonFloor, Brigade Group\'s own retail page, JLL): Brigade Metropolis was delivered around 2010, before RERA\'s 2017 enactment.',
    confidence: 'confirmed',
  },
];
