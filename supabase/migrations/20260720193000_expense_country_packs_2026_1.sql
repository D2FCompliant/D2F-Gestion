-- D2F Platform 3.2.0 - sourced Country Packs, never auto-published.
update public.d2f_country_pack_versions set status='suspended',updated_at=now() where status='published' and created_by='D2F Platform 3.1.0 migration' and manifest#>>'{expense,legalThresholds,status}'='human_validation_required';

insert into public.d2f_country_pack_versions(pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,effective_from,created_by) values ('country.fr.expenses','FR','2026.1.0','regulatory_review','','D2F Platform Engineering','{
  "schemaVersion": "1.0.0",
  "packId": "country.fr.expenses",
  "country": "FR",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "EUR",
  "languages": [
    "fr",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "fr.meal.workplace.2026",
        "kind": "allowance_limit",
        "category": "meal",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-meals"
        ],
        "conditions": {
          "mealContext": "workplace"
        },
        "limit": {
          "currency": "EUR",
          "amount": 7.5
        }
      },
      {
        "id": "fr.meal.travel.nonrestaurant.2026",
        "kind": "allowance_limit",
        "category": "meal",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-meals"
        ],
        "conditions": {
          "mealContext": "travel_non_restaurant"
        },
        "limit": {
          "currency": "EUR",
          "amount": 10.4
        }
      },
      {
        "id": "fr.meal.travel.restaurant.2026",
        "kind": "allowance_limit",
        "category": "meal",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-meals"
        ],
        "conditions": {
          "mealContext": "travel_restaurant"
        },
        "limit": {
          "currency": "EUR",
          "amount": 21.4
        }
      },
      {
        "id": "fr.mileage.car.2026",
        "kind": "mileage_matrix",
        "category": "mileage",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-mileage"
        ],
        "requirements": [
          "distanceKm",
          "vehicleFiscalPower",
          "annualBusinessKm"
        ],
        "limit": {
          "currency": "EUR",
          "bands": [
            {
              "maxKm": 5000,
              "rates": {
                "3": 0.529,
                "4": 0.606,
                "5": 0.636,
                "6": 0.665,
                "7": 0.697
              }
            },
            {
              "minKm": 5001,
              "maxKm": 20000,
              "rates": {
                "3": 0.316,
                "4": 0.34,
                "5": 0.357,
                "6": 0.374,
                "7": 0.394
              },
              "fixed": {
                "3": 1065,
                "4": 1330,
                "5": 1395,
                "6": 1457,
                "7": 1515
              }
            },
            {
              "minKm": 20001,
              "rates": {
                "3": 0.37,
                "4": 0.407,
                "5": 0.427,
                "6": 0.447,
                "7": 0.47
              }
            }
          ],
          "electricMultiplier": 1.2
        }
      },
      {
        "id": "fr.vat.context",
        "kind": "vat_treatment",
        "category": [
          "meal",
          "accommodation",
          "public_transport"
        ],
        "effect": "manual_review",
        "sourceIds": [
          "fr-vat"
        ]
      }
    ]
  },
  "retention": {
    "mode": "fixed_minimum",
    "minimumYears": 10,
    "requiresLegalReview": false,
    "sourceIds": [
      "fr-retention"
    ]
  },
  "sources": [
    {
      "id": "fr-meals",
      "authority": "URSSAF",
      "title": "Professional expenses 2026 meals",
      "url": "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/frais-professionnels.html",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "fr-mileage",
      "authority": "URSSAF",
      "title": "Mileage allowances 2026",
      "url": "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/indemnites-kilometriques.html",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "fr-vat",
      "authority": "DGFiP BOFiP",
      "title": "VAT deduction restrictions",
      "url": "https://bofip.impots.gouv.fr/export/pdf/1440",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "fr-retention",
      "authority": "DILA",
      "title": "Accounting evidence retention",
      "url": "https://entreprendre.service-public.fr/vosdroits/F10029",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "VAT depends on invoice and beneficiary",
    "Long trips require extra context"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}'::jsonb,encode(digest('{
  "schemaVersion": "1.0.0",
  "packId": "country.fr.expenses",
  "country": "FR",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "EUR",
  "languages": [
    "fr",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "fr.meal.workplace.2026",
        "kind": "allowance_limit",
        "category": "meal",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-meals"
        ],
        "conditions": {
          "mealContext": "workplace"
        },
        "limit": {
          "currency": "EUR",
          "amount": 7.5
        }
      },
      {
        "id": "fr.meal.travel.nonrestaurant.2026",
        "kind": "allowance_limit",
        "category": "meal",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-meals"
        ],
        "conditions": {
          "mealContext": "travel_non_restaurant"
        },
        "limit": {
          "currency": "EUR",
          "amount": 10.4
        }
      },
      {
        "id": "fr.meal.travel.restaurant.2026",
        "kind": "allowance_limit",
        "category": "meal",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-meals"
        ],
        "conditions": {
          "mealContext": "travel_restaurant"
        },
        "limit": {
          "currency": "EUR",
          "amount": 21.4
        }
      },
      {
        "id": "fr.mileage.car.2026",
        "kind": "mileage_matrix",
        "category": "mileage",
        "effect": "social_exemption_limit",
        "sourceIds": [
          "fr-mileage"
        ],
        "requirements": [
          "distanceKm",
          "vehicleFiscalPower",
          "annualBusinessKm"
        ],
        "limit": {
          "currency": "EUR",
          "bands": [
            {
              "maxKm": 5000,
              "rates": {
                "3": 0.529,
                "4": 0.606,
                "5": 0.636,
                "6": 0.665,
                "7": 0.697
              }
            },
            {
              "minKm": 5001,
              "maxKm": 20000,
              "rates": {
                "3": 0.316,
                "4": 0.34,
                "5": 0.357,
                "6": 0.374,
                "7": 0.394
              },
              "fixed": {
                "3": 1065,
                "4": 1330,
                "5": 1395,
                "6": 1457,
                "7": 1515
              }
            },
            {
              "minKm": 20001,
              "rates": {
                "3": 0.37,
                "4": 0.407,
                "5": 0.427,
                "6": 0.447,
                "7": 0.47
              }
            }
          ],
          "electricMultiplier": 1.2
        }
      },
      {
        "id": "fr.vat.context",
        "kind": "vat_treatment",
        "category": [
          "meal",
          "accommodation",
          "public_transport"
        ],
        "effect": "manual_review",
        "sourceIds": [
          "fr-vat"
        ]
      }
    ]
  },
  "retention": {
    "mode": "fixed_minimum",
    "minimumYears": 10,
    "requiresLegalReview": false,
    "sourceIds": [
      "fr-retention"
    ]
  },
  "sources": [
    {
      "id": "fr-meals",
      "authority": "URSSAF",
      "title": "Professional expenses 2026 meals",
      "url": "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/frais-professionnels.html",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "fr-mileage",
      "authority": "URSSAF",
      "title": "Mileage allowances 2026",
      "url": "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/indemnites-kilometriques.html",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "fr-vat",
      "authority": "DGFiP BOFiP",
      "title": "VAT deduction restrictions",
      "url": "https://bofip.impots.gouv.fr/export/pdf/1440",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "fr-retention",
      "authority": "DILA",
      "title": "Accounting evidence retention",
      "url": "https://entreprendre.service-public.fr/vosdroits/F10029",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "VAT depends on invoice and beneficiary",
    "Long trips require extra context"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}','sha256'),'hex'),'2026-01-01'::timestamptz,'D2F Platform 3.2.0') on conflict(pack_id,pack_version) do update set manifest=excluded.manifest,manifest_sha256=excluded.manifest_sha256,updated_at=now();
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/frais-professionnels.html','URSSAF',null,encode(digest('https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/frais-professionnels.html|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','fr-meals','title','Professional expenses 2026 meals','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.fr.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/indemnites-kilometriques.html','URSSAF',null,encode(digest('https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/indemnites-kilometriques.html|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','fr-mileage','title','Mileage allowances 2026','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.fr.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://bofip.impots.gouv.fr/export/pdf/1440','DGFiP BOFiP',null,encode(digest('https://bofip.impots.gouv.fr/export/pdf/1440|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','fr-vat','title','VAT deduction restrictions','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.fr.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://entreprendre.service-public.fr/vosdroits/F10029','DILA',null,encode(digest('https://entreprendre.service-public.fr/vosdroits/F10029|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','fr-retention','title','Accounting evidence retention','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.fr.expenses' and pack_version='2026.1.0' on conflict do nothing;

insert into public.d2f_country_pack_versions(pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,effective_from,created_by) values ('country.rs.expenses','RS','2026.1.0','regulatory_review','','D2F Platform Engineering','{
  "schemaVersion": "1.0.0",
  "packId": "country.rs.expenses",
  "country": "RS",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "RSD",
  "languages": [
    "sr",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "rs.perdiem.domestic.2026",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "salary_tax_exemption_limit",
        "sourceIds": [
          "rs-income"
        ],
        "conditions": {
          "tripScope": "domestic"
        },
        "requirements": [
          "tripOrder",
          "durationHours"
        ],
        "limit": {
          "currency": "RSD",
          "amount": 3380,
          "halfDayAmount": 1690
        }
      },
      {
        "id": "rs.perdiem.foreign.2026",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "salary_tax_exemption_limit",
        "sourceIds": [
          "rs-income"
        ],
        "conditions": {
          "tripScope": "foreign"
        },
        "requirements": [
          "tripOrder",
          "durationHours"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 90,
          "conversion": "NBS_middle_rate"
        }
      },
      {
        "id": "rs.lodging.invoice",
        "kind": "actual_cost",
        "category": "accommodation",
        "effect": "documented_exemption",
        "sourceIds": [
          "rs-income"
        ],
        "requirements": [
          "lodgingInvoice"
        ]
      },
      {
        "id": "rs.personal.car.2026",
        "kind": "fuel_formula_monthly_cap",
        "category": "mileage",
        "effect": "salary_tax_exemption_limit",
        "sourceIds": [
          "rs-income"
        ],
        "requirements": [
          "authorisation",
          "distanceKm",
          "fuelUnitPrice"
        ],
        "limit": {
          "factorOfFuelUnitPrice": 0.3,
          "monthlyCap": {
            "currency": "RSD",
            "amount": 9855
          }
        }
      },
      {
        "id": "rs.vat.business",
        "kind": "vat_treatment",
        "category": "*",
        "effect": "manual_review",
        "sourceIds": [
          "rs-vat"
        ]
      }
    ]
  },
  "retention": {
    "mode": "fixed_by_document_type",
    "sourceDocumentsYears": 5,
    "ledgerYears": 10,
    "requiresLegalReview": false
  },
  "sources": [
    {
      "id": "rs-income",
      "authority": "PIS RS",
      "title": "Personal income tax law article 18",
      "url": "https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=438284&uuid=8d7c110b-252e-41b2-bff9-35a15a22dc37",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "rs-vat",
      "authority": "PIS RS",
      "title": "VAT law",
      "url": "https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=439341&uuid=4fabbd92-1c61-4b59-b707-1158c8957e92",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "rs-accounting",
      "authority": "Ministry Finance RS",
      "title": "Accounting law",
      "url": "https://mfin.gov.rs/propisi/-zakon-o-racunovodstvu-sluzbeni-glasnik-rs-br-732019",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "Collective agreements may reimburse above tax-free limit",
    "2026 draft law excluded"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}'::jsonb,encode(digest('{
  "schemaVersion": "1.0.0",
  "packId": "country.rs.expenses",
  "country": "RS",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "RSD",
  "languages": [
    "sr",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "rs.perdiem.domestic.2026",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "salary_tax_exemption_limit",
        "sourceIds": [
          "rs-income"
        ],
        "conditions": {
          "tripScope": "domestic"
        },
        "requirements": [
          "tripOrder",
          "durationHours"
        ],
        "limit": {
          "currency": "RSD",
          "amount": 3380,
          "halfDayAmount": 1690
        }
      },
      {
        "id": "rs.perdiem.foreign.2026",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "salary_tax_exemption_limit",
        "sourceIds": [
          "rs-income"
        ],
        "conditions": {
          "tripScope": "foreign"
        },
        "requirements": [
          "tripOrder",
          "durationHours"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 90,
          "conversion": "NBS_middle_rate"
        }
      },
      {
        "id": "rs.lodging.invoice",
        "kind": "actual_cost",
        "category": "accommodation",
        "effect": "documented_exemption",
        "sourceIds": [
          "rs-income"
        ],
        "requirements": [
          "lodgingInvoice"
        ]
      },
      {
        "id": "rs.personal.car.2026",
        "kind": "fuel_formula_monthly_cap",
        "category": "mileage",
        "effect": "salary_tax_exemption_limit",
        "sourceIds": [
          "rs-income"
        ],
        "requirements": [
          "authorisation",
          "distanceKm",
          "fuelUnitPrice"
        ],
        "limit": {
          "factorOfFuelUnitPrice": 0.3,
          "monthlyCap": {
            "currency": "RSD",
            "amount": 9855
          }
        }
      },
      {
        "id": "rs.vat.business",
        "kind": "vat_treatment",
        "category": "*",
        "effect": "manual_review",
        "sourceIds": [
          "rs-vat"
        ]
      }
    ]
  },
  "retention": {
    "mode": "fixed_by_document_type",
    "sourceDocumentsYears": 5,
    "ledgerYears": 10,
    "requiresLegalReview": false
  },
  "sources": [
    {
      "id": "rs-income",
      "authority": "PIS RS",
      "title": "Personal income tax law article 18",
      "url": "https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=438284&uuid=8d7c110b-252e-41b2-bff9-35a15a22dc37",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "rs-vat",
      "authority": "PIS RS",
      "title": "VAT law",
      "url": "https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=439341&uuid=4fabbd92-1c61-4b59-b707-1158c8957e92",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "rs-accounting",
      "authority": "Ministry Finance RS",
      "title": "Accounting law",
      "url": "https://mfin.gov.rs/propisi/-zakon-o-racunovodstvu-sluzbeni-glasnik-rs-br-732019",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "Collective agreements may reimburse above tax-free limit",
    "2026 draft law excluded"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}','sha256'),'hex'),'2026-01-01'::timestamptz,'D2F Platform 3.2.0') on conflict(pack_id,pack_version) do update set manifest=excluded.manifest,manifest_sha256=excluded.manifest_sha256,updated_at=now();
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=438284&uuid=8d7c110b-252e-41b2-bff9-35a15a22dc37','PIS RS',null,encode(digest('https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=438284&uuid=8d7c110b-252e-41b2-bff9-35a15a22dc37|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','rs-income','title','Personal income tax law article 18','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.rs.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=439341&uuid=4fabbd92-1c61-4b59-b707-1158c8957e92','PIS RS',null,encode(digest('https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=439341&uuid=4fabbd92-1c61-4b59-b707-1158c8957e92|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','rs-vat','title','VAT law','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.rs.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://mfin.gov.rs/propisi/-zakon-o-racunovodstvu-sluzbeni-glasnik-rs-br-732019','Ministry Finance RS',null,encode(digest('https://mfin.gov.rs/propisi/-zakon-o-racunovodstvu-sluzbeni-glasnik-rs-br-732019|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','rs-accounting','title','Accounting law','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.rs.expenses' and pack_version='2026.1.0' on conflict do nothing;

insert into public.d2f_country_pack_versions(pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,effective_from,created_by) values ('country.it.expenses','IT','2026.1.0','regulatory_review','','D2F Platform Engineering','{
  "schemaVersion": "1.0.0",
  "packId": "country.it.expenses",
  "country": "IT",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "EUR",
  "languages": [
    "it",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "it.traceable.domestic.2026",
        "kind": "payment_traceability",
        "category": [
          "meal",
          "accommodation",
          "taxi",
          "ride_hailing"
        ],
        "effect": "deductible_only_if_traceable",
        "sourceIds": [
          "it-dl84"
        ],
        "conditions": {
          "expenseTerritory": "IT"
        },
        "requirements": [
          "traceablePayment"
        ]
      },
      {
        "id": "it.perdiem.domestic",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "employee_income_exemption_limit",
        "sourceIds": [
          "it-tuir"
        ],
        "conditions": {
          "tripScope": "domestic"
        },
        "limit": {
          "currency": "EUR",
          "amount": 46.48
        }
      },
      {
        "id": "it.perdiem.foreign",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "employee_income_exemption_limit",
        "sourceIds": [
          "it-tuir"
        ],
        "conditions": {
          "tripScope": "foreign"
        },
        "limit": {
          "currency": "EUR",
          "amount": 77.47
        }
      },
      {
        "id": "it.vat.meal.lodging",
        "kind": "vat_treatment",
        "category": [
          "meal",
          "accommodation"
        ],
        "effect": "manual_review",
        "sourceIds": [
          "it-vat"
        ],
        "requirements": [
          "invoiceToCompany"
        ]
      }
    ]
  },
  "retention": {
    "mode": "fixed_minimum",
    "minimumYears": 10,
    "requiresLegalReview": true
  },
  "sources": [
    {
      "id": "it-dl84",
      "authority": "Normattiva",
      "title": "DL 84/2025 traceable payments",
      "url": "https://www.normattiva.it/eli/id/2025/08/01/25A04376/ORIGINAL",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "it-tuir",
      "authority": "Normattiva",
      "title": "DPR 917/1986 TUIR article 51",
      "url": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1986;917~art51=",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "it-vat",
      "authority": "Agenzia Entrate",
      "title": "VAT meals and lodging",
      "url": "https://www.agenziaentrate.gov.it/",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "it-retention",
      "authority": "Agenzia Entrate",
      "title": "Electronic invoice retention",
      "url": "https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "VAT depends on invoice holder and business link"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}'::jsonb,encode(digest('{
  "schemaVersion": "1.0.0",
  "packId": "country.it.expenses",
  "country": "IT",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "EUR",
  "languages": [
    "it",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "it.traceable.domestic.2026",
        "kind": "payment_traceability",
        "category": [
          "meal",
          "accommodation",
          "taxi",
          "ride_hailing"
        ],
        "effect": "deductible_only_if_traceable",
        "sourceIds": [
          "it-dl84"
        ],
        "conditions": {
          "expenseTerritory": "IT"
        },
        "requirements": [
          "traceablePayment"
        ]
      },
      {
        "id": "it.perdiem.domestic",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "employee_income_exemption_limit",
        "sourceIds": [
          "it-tuir"
        ],
        "conditions": {
          "tripScope": "domestic"
        },
        "limit": {
          "currency": "EUR",
          "amount": 46.48
        }
      },
      {
        "id": "it.perdiem.foreign",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "employee_income_exemption_limit",
        "sourceIds": [
          "it-tuir"
        ],
        "conditions": {
          "tripScope": "foreign"
        },
        "limit": {
          "currency": "EUR",
          "amount": 77.47
        }
      },
      {
        "id": "it.vat.meal.lodging",
        "kind": "vat_treatment",
        "category": [
          "meal",
          "accommodation"
        ],
        "effect": "manual_review",
        "sourceIds": [
          "it-vat"
        ],
        "requirements": [
          "invoiceToCompany"
        ]
      }
    ]
  },
  "retention": {
    "mode": "fixed_minimum",
    "minimumYears": 10,
    "requiresLegalReview": true
  },
  "sources": [
    {
      "id": "it-dl84",
      "authority": "Normattiva",
      "title": "DL 84/2025 traceable payments",
      "url": "https://www.normattiva.it/eli/id/2025/08/01/25A04376/ORIGINAL",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "it-tuir",
      "authority": "Normattiva",
      "title": "DPR 917/1986 TUIR article 51",
      "url": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1986;917~art51=",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "it-vat",
      "authority": "Agenzia Entrate",
      "title": "VAT meals and lodging",
      "url": "https://www.agenziaentrate.gov.it/",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "it-retention",
      "authority": "Agenzia Entrate",
      "title": "Electronic invoice retention",
      "url": "https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "VAT depends on invoice holder and business link"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}','sha256'),'hex'),'2026-01-01'::timestamptz,'D2F Platform 3.2.0') on conflict(pack_id,pack_version) do update set manifest=excluded.manifest,manifest_sha256=excluded.manifest_sha256,updated_at=now();
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www.normattiva.it/eli/id/2025/08/01/25A04376/ORIGINAL','Normattiva',null,encode(digest('https://www.normattiva.it/eli/id/2025/08/01/25A04376/ORIGINAL|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','it-dl84','title','DL 84/2025 traceable payments','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.it.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1986;917~art51=','Normattiva',null,encode(digest('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1986;917~art51=|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','it-tuir','title','DPR 917/1986 TUIR article 51','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.it.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www.agenziaentrate.gov.it/','Agenzia Entrate',null,encode(digest('https://www.agenziaentrate.gov.it/|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','it-vat','title','VAT meals and lodging','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.it.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html','Agenzia Entrate',null,encode(digest('https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','it-retention','title','Electronic invoice retention','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.it.expenses' and pack_version='2026.1.0' on conflict do nothing;

insert into public.d2f_country_pack_versions(pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,effective_from,created_by) values ('country.es.expenses','ES','2026.1.0','regulatory_review','','D2F Platform Engineering','{
  "schemaVersion": "1.0.0",
  "packId": "country.es.expenses",
  "country": "ES",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "EUR",
  "languages": [
    "es",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "es.mileage.2026",
        "kind": "per_unit_limit",
        "category": "mileage",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "requirements": [
          "distanceKm",
          "businessTripEvidence"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 0.26,
          "unit": "km",
          "extras": [
            "toll",
            "parking"
          ]
        }
      },
      {
        "id": "es.perdiem.domestic.false",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "domestic",
          "overnight": false
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 26.67
        }
      },
      {
        "id": "es.perdiem.foreign.false",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "foreign",
          "overnight": false
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 48.08
        }
      },
      {
        "id": "es.perdiem.domestic.true",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "domestic",
          "overnight": true
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 53.34
        }
      },
      {
        "id": "es.perdiem.foreign.true",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "foreign",
          "overnight": true
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 91.35
        }
      },
      {
        "id": "es.vat.travel",
        "kind": "vat_treatment",
        "category": "*",
        "effect": "manual_review",
        "sourceIds": [
          "es-vat"
        ]
      }
    ]
  },
  "retention": {
    "mode": "dual_period",
    "minimumYears": 4,
    "commercialYears": 6,
    "requiresLegalReview": true
  },
  "sources": [
    {
      "id": "es-irpf",
      "authority": "BOE",
      "title": "RD 439/2007 IRPF article 9",
      "url": "https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820&p=20231228&tn=1",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "es-vat",
      "authority": "BOE",
      "title": "Law 37/1992 VAT articles 95-96",
      "url": "https://boe.es/buscar/act.php?id=BOE-A-1992-28740&p=20260228&tn=0",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "es-retention",
      "authority": "AEAT",
      "title": "Invoice retention",
      "url": "https://sede.agenciatributaria.gob.es/",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "Foral territories and Canary Islands require subpacks"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}'::jsonb,encode(digest('{
  "schemaVersion": "1.0.0",
  "packId": "country.es.expenses",
  "country": "ES",
  "module": "expenses",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "effectiveFrom": "2026-01-01",
  "verifiedAt": "2026-07-20",
  "currency": "EUR",
  "languages": [
    "es",
    "en"
  ],
  "automaticPublication": false,
  "expense": {
    "allowedCategories": [
      "meal",
      "accommodation",
      "fuel",
      "toll",
      "parking",
      "train",
      "flight",
      "taxi",
      "ride_hailing",
      "public_transport",
      "vehicle_rental",
      "mileage",
      "per_diem",
      "telecommunications",
      "office_supplies",
      "representation",
      "training",
      "conference",
      "home_working",
      "miscellaneous"
    ],
    "receiptRequiredDefault": true,
    "evidenceRequirements": [
      "original_receipt",
      "business_purpose",
      "merchant",
      "expense_date",
      "payment_method"
    ],
    "rules": [
      {
        "id": "es.mileage.2026",
        "kind": "per_unit_limit",
        "category": "mileage",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "requirements": [
          "distanceKm",
          "businessTripEvidence"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 0.26,
          "unit": "km",
          "extras": [
            "toll",
            "parking"
          ]
        }
      },
      {
        "id": "es.perdiem.domestic.false",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "domestic",
          "overnight": false
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 26.67
        }
      },
      {
        "id": "es.perdiem.foreign.false",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "foreign",
          "overnight": false
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 48.08
        }
      },
      {
        "id": "es.perdiem.domestic.true",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "domestic",
          "overnight": true
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 53.34
        }
      },
      {
        "id": "es.perdiem.foreign.true",
        "kind": "allowance_limit",
        "category": "per_diem",
        "effect": "income_tax_exemption_limit",
        "sourceIds": [
          "es-irpf"
        ],
        "conditions": {
          "tripScope": "foreign",
          "overnight": true
        },
        "requirements": [
          "differentMunicipality"
        ],
        "limit": {
          "currency": "EUR",
          "amount": 91.35
        }
      },
      {
        "id": "es.vat.travel",
        "kind": "vat_treatment",
        "category": "*",
        "effect": "manual_review",
        "sourceIds": [
          "es-vat"
        ]
      }
    ]
  },
  "retention": {
    "mode": "dual_period",
    "minimumYears": 4,
    "commercialYears": 6,
    "requiresLegalReview": true
  },
  "sources": [
    {
      "id": "es-irpf",
      "authority": "BOE",
      "title": "RD 439/2007 IRPF article 9",
      "url": "https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820&p=20231228&tn=1",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "es-vat",
      "authority": "BOE",
      "title": "Law 37/1992 VAT articles 95-96",
      "url": "https://boe.es/buscar/act.php?id=BOE-A-1992-28740&p=20260228&tn=0",
      "verifiedAt": "2026-07-20"
    },
    {
      "id": "es-retention",
      "authority": "AEAT",
      "title": "Invoice retention",
      "url": "https://sede.agenciatributaria.gob.es/",
      "verifiedAt": "2026-07-20"
    }
  ],
  "unresolvedDecisions": [
    "Foral territories and Canary Islands require subpacks"
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true
  }
}','sha256'),'hex'),'2026-01-01'::timestamptz,'D2F Platform 3.2.0') on conflict(pack_id,pack_version) do update set manifest=excluded.manifest,manifest_sha256=excluded.manifest_sha256,updated_at=now();
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820&p=20231228&tn=1','BOE',null,encode(digest('https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820&p=20231228&tn=1|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','es-irpf','title','RD 439/2007 IRPF article 9','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.es.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://boe.es/buscar/act.php?id=BOE-A-1992-28740&p=20260228&tn=0','BOE',null,encode(digest('https://boe.es/buscar/act.php?id=BOE-A-1992-28740&p=20260228&tn=0|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','es-vat','title','Law 37/1992 VAT articles 95-96','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.es.expenses' and pack_version='2026.1.0' on conflict do nothing;
insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata) select id,'official_source_reference','https://sede.agenciatributaria.gob.es/','AEAT',null,encode(digest('https://sede.agenciatributaria.gob.es/|2026-07-20','sha256'),'hex'),'pending',jsonb_build_object('sourceId','es-retention','title','Invoice retention','hashScope','reference_metadata') from public.d2f_country_pack_versions where pack_id='country.es.expenses' and pack_version='2026.1.0' on conflict do nothing;


create or replace function public.d2f_publish_country_pack_v1(p_pack_version_id uuid,p_actor text)
returns public.d2f_country_pack_versions language plpgsql security definer set search_path=public as $$
declare v_pack public.d2f_country_pack_versions; v_regulatory boolean; v_technical boolean; v_security boolean; v_pending boolean;
begin
 select * into v_pack from public.d2f_country_pack_versions where id=p_pack_version_id for update;
 if v_pack.id is null then raise exception 'Country Pack version not found'; end if;
 if trim(v_pack.regulatory_owner)='' or trim(v_pack.technical_owner)='' then raise exception 'Regulatory and technical owners are required'; end if;
 select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='regulatory' and decision='approved') into v_regulatory;
 select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='technical' and decision='approved') into v_technical;
 select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='security' and decision='approved') into v_security;
 select exists(select 1 from public.d2f_country_pack_evidence where pack_version_id=v_pack.id and verification_status<>'verified') into v_pending;
 if not v_regulatory or not v_technical or not v_security then raise exception 'Regulatory, technical and security approvals are required'; end if;
 if v_pending then raise exception 'Every Country Pack evidence item must be verified'; end if;
 if coalesce((v_pack.manifest->'automaticPublication')::boolean,true) then raise exception 'Automatic Country Pack publication is forbidden'; end if;
 update public.d2f_country_pack_versions set status='superseded',updated_at=now() where country=v_pack.country and status='published' and id<>v_pack.id;
 update public.d2f_country_pack_versions set status='published',effective_from=coalesce(effective_from,now()),published_at=now(),updated_at=now(),created_by=coalesce(nullif(created_by,''),p_actor) where id=v_pack.id returning * into v_pack;
 return v_pack;
end $$;
revoke all on function public.d2f_publish_country_pack_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.d2f_publish_country_pack_v1(uuid,text) to service_role;
