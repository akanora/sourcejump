//! Country names as Steam writes them in a profile's location, mapped to ISO 3166-1 alpha-2 codes.
//!
//! Steam's profile XML has no country code, only a location string in English that ends with the country
//! ("Oslo, Oslo, Norway"). Steam's names follow an older ISO list, so each code lists the current ISO name, the
//! older one where it differs, and common short forms. An unknown name means no flag, never a guess.

/// Each code with every name that means it. Matching ignores case.
const COUNTRIES: &[(&str, &[&str])] = &[
    ("AD", &["Andorra"]),
    ("AE", &["United Arab Emirates", "UAE"]),
    ("AF", &["Afghanistan"]),
    ("AG", &["Antigua and Barbuda"]),
    ("AI", &["Anguilla"]),
    ("AL", &["Albania"]),
    ("AM", &["Armenia"]),
    ("AO", &["Angola"]),
    ("AQ", &["Antarctica"]),
    ("AR", &["Argentina"]),
    ("AS", &["American Samoa"]),
    ("AT", &["Austria"]),
    ("AU", &["Australia"]),
    ("AW", &["Aruba"]),
    ("AX", &["Åland Islands", "Aland Islands"]),
    ("AZ", &["Azerbaijan"]),
    ("BA", &["Bosnia and Herzegovina"]),
    ("BB", &["Barbados"]),
    ("BD", &["Bangladesh"]),
    ("BE", &["Belgium"]),
    ("BF", &["Burkina Faso"]),
    ("BG", &["Bulgaria"]),
    ("BH", &["Bahrain"]),
    ("BI", &["Burundi"]),
    ("BJ", &["Benin"]),
    ("BL", &["Saint Barthélemy", "Saint Barthelemy"]),
    ("BM", &["Bermuda"]),
    ("BN", &["Brunei Darussalam", "Brunei"]),
    ("BO", &["Bolivia", "Bolivia, Plurinational State of"]),
    ("BQ", &["Bonaire, Sint Eustatius and Saba"]),
    ("BR", &["Brazil"]),
    ("BS", &["Bahamas"]),
    ("BT", &["Bhutan"]),
    ("BV", &["Bouvet Island"]),
    ("BW", &["Botswana"]),
    ("BY", &["Belarus"]),
    ("BZ", &["Belize"]),
    ("CA", &["Canada"]),
    ("CC", &["Cocos (Keeling) Islands"]),
    (
        "CD",
        &[
            "Congo, the Democratic Republic of the",
            "Congo, The Democratic Republic of the",
            "Democratic Republic of the Congo",
        ],
    ),
    ("CF", &["Central African Republic"]),
    ("CG", &["Congo", "Republic of the Congo"]),
    ("CH", &["Switzerland"]),
    ("CI", &["Cote D'Ivoire", "Côte d'Ivoire", "Ivory Coast"]),
    ("CK", &["Cook Islands"]),
    ("CL", &["Chile"]),
    ("CM", &["Cameroon"]),
    ("CN", &["China"]),
    ("CO", &["Colombia"]),
    ("CR", &["Costa Rica"]),
    ("CU", &["Cuba"]),
    ("CV", &["Cape Verde", "Cabo Verde"]),
    ("CW", &["Curaçao", "Curacao"]),
    ("CX", &["Christmas Island"]),
    ("CY", &["Cyprus"]),
    ("CZ", &["Czech Republic", "Czechia"]),
    ("DE", &["Germany"]),
    ("DJ", &["Djibouti"]),
    ("DK", &["Denmark"]),
    ("DM", &["Dominica"]),
    ("DO", &["Dominican Republic"]),
    ("DZ", &["Algeria"]),
    ("EC", &["Ecuador"]),
    ("EE", &["Estonia"]),
    ("EG", &["Egypt"]),
    ("EH", &["Western Sahara"]),
    ("ER", &["Eritrea"]),
    ("ES", &["Spain"]),
    ("ET", &["Ethiopia"]),
    ("FI", &["Finland"]),
    ("FJ", &["Fiji"]),
    ("FK", &["Falkland Islands (Malvinas)", "Falkland Islands"]),
    ("FM", &["Micronesia, Federated States of", "Micronesia"]),
    ("FO", &["Faroe Islands"]),
    ("FR", &["France"]),
    ("GA", &["Gabon"]),
    (
        "GB",
        &[
            "United Kingdom",
            "United Kingdom of Great Britain and Northern Ireland",
            "Great Britain",
            "UK",
        ],
    ),
    ("GD", &["Grenada"]),
    ("GE", &["Georgia"]),
    ("GF", &["French Guiana"]),
    ("GG", &["Guernsey"]),
    ("GH", &["Ghana"]),
    ("GI", &["Gibraltar"]),
    ("GL", &["Greenland"]),
    ("GM", &["Gambia"]),
    ("GN", &["Guinea"]),
    ("GP", &["Guadeloupe"]),
    ("GQ", &["Equatorial Guinea"]),
    ("GR", &["Greece"]),
    ("GS", &["South Georgia and the South Sandwich Islands"]),
    ("GT", &["Guatemala"]),
    ("GU", &["Guam"]),
    ("GW", &["Guinea-Bissau"]),
    ("GY", &["Guyana"]),
    ("HK", &["Hong Kong"]),
    (
        "HM",
        &[
            "Heard Island and Mcdonald Islands",
            "Heard Island and McDonald Islands",
        ],
    ),
    ("HN", &["Honduras"]),
    ("HR", &["Croatia"]),
    ("HT", &["Haiti"]),
    ("HU", &["Hungary"]),
    ("ID", &["Indonesia"]),
    ("IE", &["Ireland"]),
    ("IL", &["Israel"]),
    ("IM", &["Isle of Man"]),
    ("IN", &["India"]),
    ("IO", &["British Indian Ocean Territory"]),
    ("IQ", &["Iraq"]),
    ("IR", &["Iran, Islamic Republic of", "Iran"]),
    ("IS", &["Iceland"]),
    ("IT", &["Italy"]),
    ("JE", &["Jersey"]),
    ("JM", &["Jamaica"]),
    ("JO", &["Jordan"]),
    ("JP", &["Japan"]),
    ("KE", &["Kenya"]),
    ("KG", &["Kyrgyzstan"]),
    ("KH", &["Cambodia"]),
    ("KI", &["Kiribati"]),
    ("KM", &["Comoros"]),
    ("KN", &["Saint Kitts and Nevis"]),
    (
        "KP",
        &["Korea, Democratic People's Republic of", "North Korea"],
    ),
    ("KR", &["Korea, Republic of", "South Korea", "Korea"]),
    ("KW", &["Kuwait"]),
    ("KY", &["Cayman Islands"]),
    ("KZ", &["Kazakhstan"]),
    ("LA", &["Lao People's Democratic Republic", "Laos"]),
    ("LB", &["Lebanon"]),
    ("LC", &["Saint Lucia"]),
    ("LI", &["Liechtenstein"]),
    ("LK", &["Sri Lanka"]),
    ("LR", &["Liberia"]),
    ("LS", &["Lesotho"]),
    ("LT", &["Lithuania"]),
    ("LU", &["Luxembourg"]),
    ("LV", &["Latvia"]),
    ("LY", &["Libyan Arab Jamahiriya", "Libya"]),
    ("MA", &["Morocco"]),
    ("MC", &["Monaco"]),
    ("MD", &["Moldova, Republic of", "Moldova"]),
    ("ME", &["Montenegro"]),
    ("MF", &["Saint Martin (French part)", "Saint Martin"]),
    ("MG", &["Madagascar"]),
    ("MH", &["Marshall Islands"]),
    (
        "MK",
        &[
            "Macedonia, the Former Yugoslav Republic of",
            "North Macedonia",
            "Macedonia",
        ],
    ),
    ("ML", &["Mali"]),
    ("MM", &["Myanmar"]),
    ("MN", &["Mongolia"]),
    ("MO", &["Macao", "Macau"]),
    ("MP", &["Northern Mariana Islands"]),
    ("MQ", &["Martinique"]),
    ("MR", &["Mauritania"]),
    ("MS", &["Montserrat"]),
    ("MT", &["Malta"]),
    ("MU", &["Mauritius"]),
    ("MV", &["Maldives"]),
    ("MW", &["Malawi"]),
    ("MX", &["Mexico"]),
    ("MY", &["Malaysia"]),
    ("MZ", &["Mozambique"]),
    ("NA", &["Namibia"]),
    ("NC", &["New Caledonia"]),
    ("NE", &["Niger"]),
    ("NF", &["Norfolk Island"]),
    ("NG", &["Nigeria"]),
    ("NI", &["Nicaragua"]),
    ("NL", &["Netherlands"]),
    ("NO", &["Norway"]),
    ("NP", &["Nepal"]),
    ("NR", &["Nauru"]),
    ("NU", &["Niue"]),
    ("NZ", &["New Zealand"]),
    ("OM", &["Oman"]),
    ("PA", &["Panama"]),
    ("PE", &["Peru"]),
    ("PF", &["French Polynesia"]),
    ("PG", &["Papua New Guinea"]),
    ("PH", &["Philippines"]),
    ("PK", &["Pakistan"]),
    ("PL", &["Poland"]),
    ("PM", &["Saint Pierre and Miquelon"]),
    ("PN", &["Pitcairn"]),
    ("PR", &["Puerto Rico"]),
    (
        "PS",
        &[
            "Palestinian Territory, Occupied",
            "Palestine, State of",
            "Palestine",
        ],
    ),
    ("PT", &["Portugal"]),
    ("PW", &["Palau"]),
    ("PY", &["Paraguay"]),
    ("QA", &["Qatar"]),
    ("RE", &["Reunion", "Réunion"]),
    ("RO", &["Romania"]),
    ("RS", &["Serbia"]),
    ("RU", &["Russian Federation", "Russia"]),
    ("RW", &["Rwanda"]),
    ("SA", &["Saudi Arabia"]),
    ("SB", &["Solomon Islands"]),
    ("SC", &["Seychelles"]),
    ("SD", &["Sudan"]),
    ("SE", &["Sweden"]),
    ("SG", &["Singapore"]),
    (
        "SH",
        &[
            "Saint Helena",
            "Saint Helena, Ascension and Tristan da Cunha",
        ],
    ),
    ("SI", &["Slovenia"]),
    ("SJ", &["Svalbard and Jan Mayen"]),
    ("SK", &["Slovakia"]),
    ("SL", &["Sierra Leone"]),
    ("SM", &["San Marino"]),
    ("SN", &["Senegal"]),
    ("SO", &["Somalia"]),
    ("SR", &["Suriname"]),
    ("SS", &["South Sudan"]),
    ("ST", &["Sao Tome and Principe"]),
    ("SV", &["El Salvador"]),
    ("SX", &["Sint Maarten (Dutch part)", "Sint Maarten"]),
    ("SY", &["Syrian Arab Republic", "Syria"]),
    ("SZ", &["Swaziland", "Eswatini"]),
    ("TC", &["Turks and Caicos Islands"]),
    ("TD", &["Chad"]),
    ("TF", &["French Southern Territories"]),
    ("TG", &["Togo"]),
    ("TH", &["Thailand"]),
    ("TJ", &["Tajikistan"]),
    ("TK", &["Tokelau"]),
    ("TL", &["Timor-Leste", "East Timor"]),
    ("TM", &["Turkmenistan"]),
    ("TN", &["Tunisia"]),
    ("TO", &["Tonga"]),
    ("TR", &["Turkey", "Türkiye"]),
    ("TT", &["Trinidad and Tobago"]),
    ("TV", &["Tuvalu"]),
    ("TW", &["Taiwan", "Taiwan, Province of China"]),
    ("TZ", &["Tanzania, United Republic of", "Tanzania"]),
    ("UA", &["Ukraine"]),
    ("UG", &["Uganda"]),
    ("UM", &["United States Minor Outlying Islands"]),
    ("US", &["United States", "United States of America", "USA"]),
    ("UY", &["Uruguay"]),
    ("UZ", &["Uzbekistan"]),
    ("VA", &["Holy See (Vatican City State)", "Vatican City"]),
    ("VC", &["Saint Vincent and the Grenadines"]),
    ("VE", &["Venezuela", "Venezuela, Bolivarian Republic of"]),
    ("VG", &["Virgin Islands, British", "British Virgin Islands"]),
    ("VI", &["Virgin Islands, U.S.", "U.S. Virgin Islands"]),
    ("VN", &["Viet Nam", "Vietnam"]),
    ("VU", &["Vanuatu"]),
    ("WF", &["Wallis and Futuna"]),
    ("WS", &["Samoa"]),
    ("XK", &["Kosovo"]),
    ("YE", &["Yemen"]),
    ("YT", &["Mayotte"]),
    ("ZA", &["South Africa"]),
    ("ZM", &["Zambia"]),
    ("ZW", &["Zimbabwe"]),
];

/// The country a Steam location ends with. Tries the longest ending first, so "Korea, Republic of" wins over
/// "Republic of", and a city name that happens to match a country ("Georgia", "Jersey") can't come first.
pub fn code_for_location(location: &str) -> Option<&'static str> {
    let location = location.trim();
    let endings = std::iter::once(location).chain(
        location
            .match_indices(", ")
            .map(|(index, separator)| &location[index + separator.len()..]),
    );
    endings.map(str::trim).find_map(|ending| {
        COUNTRIES.iter().find_map(|(code, names)| {
            names
                .iter()
                .any(|name| name.eq_ignore_ascii_case(ending))
                .then_some(*code)
        })
    })
}

/// Every country a player can pick for their profile, `GET /v1/countries`.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct CountryList {
    /// ISO 3166-1 alpha-2 codes, A to Z. Clients name them in the reader's language.
    pub codes: Vec<String>,
}

/// The country codes a profile's details accept.
#[utoipa::path(
    get,
    path = "/v1/countries",
    tag = "players",
    responses((status = OK, body = CountryList)),
)]
pub async fn list_countries() -> axum::Json<CountryList> {
    axum::Json(CountryList {
        codes: COUNTRIES
            .iter()
            .map(|(code, _)| (*code).to_owned())
            .collect(),
    })
}

/// The ISO code itself, in either case, when it's one this list knows.
pub fn known_code(code: &str) -> Option<&'static str> {
    COUNTRIES
        .iter()
        .map(|(known, _)| *known)
        .find(|known| known.eq_ignore_ascii_case(code.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_codes_in_either_case() {
        assert_eq!(known_code("no"), Some("NO"));
        assert_eq!(known_code("NO"), Some("NO"));
        assert_eq!(known_code("xx"), None);
    }

    #[test]
    fn reads_the_country_at_the_end_of_a_location() {
        assert_eq!(code_for_location("Norway"), Some("NO"));
        assert_eq!(code_for_location("Oslo, Oslo, Norway"), Some("NO"));
        assert_eq!(code_for_location("Texas, United States"), Some("US"));
        assert_eq!(
            code_for_location("south georgia and the south sandwich islands"),
            Some("GS")
        );
    }

    #[test]
    fn names_with_commas_match_whole() {
        assert_eq!(code_for_location("Seoul, Korea, Republic of"), Some("KR"));
        assert_eq!(code_for_location("Virgin Islands, U.S."), Some("VI"));
        assert_eq!(code_for_location("Moscow, Russian Federation"), Some("RU"));
    }

    #[test]
    fn unknown_or_empty_locations_have_no_country() {
        assert_eq!(code_for_location(""), None);
        assert_eq!(code_for_location("Middle-earth"), None);
        assert_eq!(code_for_location("Republic of"), None);
    }

    #[test]
    fn every_code_is_two_capital_letters_and_listed_once() {
        let mut codes: Vec<&str> = COUNTRIES.iter().map(|(code, _)| *code).collect();
        assert!(
            codes
                .iter()
                .all(|code| code.len() == 2 && code.chars().all(|c| c.is_ascii_uppercase()))
        );
        let count = codes.len();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), count);
    }
}
