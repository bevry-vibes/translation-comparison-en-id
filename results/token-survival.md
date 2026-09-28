# Masked-name token survival

Provider output on production-style masked segments (names wrapped in
`U+E000 + index + U+E001`, longest-form-first glossary). A segment passes only
when every expected token survives (right index, full count), nothing was
renumbered or left behind, and every name round-trips through restoration.
Verdicts are strict: one dropped name fails the run. chrF is restored
hypothesis vs hand reference, a secondary quality hint only.

| run | model | prompt | direction | survived | verdict | restored chrF | file |
| --- | --- | --- | --- | ---: | --- | ---: | --- |
| `qwen-flash-masked-enid` | `qwen-flash` | engine-preserve | en->id | 10/10 | **PASS** | 85.67 | `qwen-flash-masked-enid.json` |
| `qwen-mt-flash-masked-enid` | `qwen-mt-flash` | none | en->id | 10/10 | **PASS** | 84.02 | `qwen-mt-flash-masked-enid.json` |
| `qwen-mt-lite-masked-enid` | `qwen-mt-lite` | none | en->id | 10/10 | **PASS** | 87.72 | `qwen-mt-lite-masked-enid.json` |
| `qwen-mt-turbo-masked-enid` | `qwen-mt-turbo` | none | en->id | 10/10 | **PASS** | 80.99 | `qwen-mt-turbo-masked-enid.json` |
| `qwen3.5-flash-masked-enid` | `qwen3.5-flash` | engine-preserve | en->id | 10/10 | **PASS** | 84.59 | `qwen3.5-flash-masked-enid.json` |
| `qwen3.6-flash-masked-enid` | `qwen3.6-flash` | engine-preserve | en->id | 10/10 | **PASS** | 84.65 | `qwen3.6-flash-masked-enid.json` |
| `qwen-mt-plus-masked-enid` | `qwen-mt-plus` | none | en->id | 7/10 | **FAIL** | 82.24 | `qwen-mt-plus-masked-enid.json` |
| `glm-4.7-flash-masked-enid` | `@cf/zai-org/glm-4.7-flash` | engine | en->id | 0/10 | **FAIL** | 61.07 | `glm-4.7-flash-masked-enid.json` |
| `glm-4.7-flash-masked-preserve-enid` | `@cf/zai-org/glm-4.7-flash` | engine-preserve | en->id | 0/10 | **FAIL** | 57.28 | `glm-4.7-flash-masked-preserve-enid.json` |
| `qwen-flash-masked-iden` | `qwen-flash` | engine-preserve | id->en | 10/10 | **PASS** | 78.77 | `qwen-flash-masked-iden.json` |
| `qwen-mt-lite-masked-iden` | `qwen-mt-lite` | none | id->en | 10/10 | **PASS** | 82.58 | `qwen-mt-lite-masked-iden.json` |
| `qwen3.5-flash-masked-iden` | `qwen3.5-flash` | engine-preserve | id->en | 10/10 | **PASS** | 82.84 | `qwen3.5-flash-masked-iden.json` |
| `qwen3.6-flash-masked-iden` | `qwen3.6-flash` | engine-preserve | id->en | 10/10 | **PASS** | 80.53 | `qwen3.6-flash-masked-iden.json` |
| `qwen-mt-turbo-masked-iden` | `qwen-mt-turbo` | none | id->en | 9/10 | **FAIL** | 74.6 | `qwen-mt-turbo-masked-iden.json` |
| `qwen-mt-flash-masked-iden` | `qwen-mt-flash` | none | id->en | 2/10 | **FAIL** | 65.75 | `qwen-mt-flash-masked-iden.json` |
| `qwen-mt-plus-masked-iden` | `qwen-mt-plus` | none | id->en | 1/10 | **FAIL** | 62.36 | `qwen-mt-plus-masked-iden.json` |
| `glm-4.7-flash-masked-iden` | `@cf/zai-org/glm-4.7-flash` | engine | id->en | 0/10 | **FAIL** | 64.54 | `glm-4.7-flash-masked-iden.json` |
| `glm-4.7-flash-masked-preserve-iden` | `@cf/zai-org/glm-4.7-flash` | engine-preserve | id->en | 0/10 | **FAIL** | 63.74 | `glm-4.7-flash-masked-preserve-iden.json` |

## glm-4.7-flash-masked-enid (en->id) failures

- `masked-enid-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: '1 memimpin pertemuan mingguan komunitas di aula utama.'
- `masked-enid-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '2 mempersiapkan laporan keuangan yayasan di akhir setiap bulan.'
- `masked-enid-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: 'Membuka pendaftaran untuk workshop perdamaian pemuda di Pati.'
- `masked-enid-04`:
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: 'Mendokumentasikan kegiatan komunitas melalui foto dan video pendek.'
- `masked-enid-05`:
  - missing token 3 (Wiwit): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - raw hypothesis: '3 membalas pesan masuk dari website setiap pagi.'
- `masked-enid-06`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 1 (Petrus): expected 1, found 0
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '1 dan 2 akan mewakili nol pada pertemuan lintas komunitas di Semarang.'
- `masked-enid-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: '5 dan 3 merekomendasikan agar peserta mendaftar sebelum tanggal 15.'
- `masked-enid-08`:
  - missing token 2 (Nanik): expected 2, found 0
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 2, restored text has 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '2 meminta 4 untuk mengarsipkan foto kegiatan, dan 2 meninjau mereka setelahnya.'
- `masked-enid-09`:
  - missing token 1 (Petrus): expected 2, found 0
  - name did not survive restoration: 'Petrus' expected 2, restored text has 0
  - raw hypothesis: 'Sesuai dengan 1, program ini telah berjalan dengan baik sejak 1 menjadi koordinator.'
- `masked-enid-10`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: 'Laporan tahunan 10 ditulis oleh 5 dengan tim mediasi.'

## glm-4.7-flash-masked-iden (id->en) failures

- `masked-iden-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: "1. Leading the community's weekly meeting in the main room."
- `masked-iden-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: "2. Prepare the foundation's financial reports at the end of every month."
- `masked-iden-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: '0. opens the peace workshop registration for the youth in Pati.'
- `masked-iden-04`:
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '4 to document community activities through photos and short videos.'
- `masked-iden-05`:
  - missing token 3 (Wiwit): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - raw hypothesis: 'Answer incoming messages through the site every morning.'
- `masked-iden-06`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 1 (Petrus): expected 1, found 0
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '1 and 2 will represent 0 at the inter-community meeting in Semarang.'
- `masked-iden-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: '5 and 3 recommend that participants register before the 15th.'
- `masked-iden-08`:
  - missing token 2 (Nanik): expected 2, found 0
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 2, restored text has 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '2 asked 4 to archive activity photos, then 2 checked them again.'
- `masked-iden-09`:
  - missing token 1 (Petrus): expected 2, found 0
  - name did not survive restoration: 'Petrus' expected 2, restored text has 0
  - raw hypothesis: 'According to 1, this program has been running well since 1 became coordinator.'
- `masked-iden-10`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: 'The 0 annual report was written by the 5 together with the mediation team.'

## glm-4.7-flash-masked-preserve-enid (en->id) failures

- `masked-enid-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: '1 memimpin pertemuan mingguan komunitas di balai utama.'
- `masked-enid-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '2 menyusun laporan keuangan yayasan setiap akhir bulan.'
- `masked-enid-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: '0 membuka pendaftaran untuk workshop perdamaian pemuda di Pati.'
- `masked-enid-04`:
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '4. Mendokumentasikan aktivitas komunitas melalui fotografi dan video pendek.'
- `masked-enid-05`:
  - missing token 3 (Wiwit): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - raw hypothesis: 'Jawab pesan masuk dari website setiap pagi.'
- `masked-enid-06`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 1 (Petrus): expected 1, found 0
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '1 dan 2 akan mewakili 0 di pertemuan antar komunitas di Semarang.'
- `masked-enid-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: '5 dan 3 merekomendasikan agar peserta mendaftar sebelum tanggal 15.'
- `masked-enid-08`:
  - missing token 2 (Nanik): expected 2, found 0
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 2, restored text has 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '2 meminta 4 untuk mengarsipkan foto-foto kegiatan, dan 2 meninjau mereka sesudahnya.'
- `masked-enid-09`:
  - missing token 1 (Petrus): expected 2, found 0
  - name did not survive restoration: 'Petrus' expected 2, restored text has 0
  - raw hypothesis: 'Menurut 1, program telah berjalan lancar sejak 1 menjadi koordinator.'
- `masked-enid-10`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: 'Laporan tahunan Zurich ditulis oleh London dengan tim mediasi.'

## glm-4.7-flash-masked-preserve-iden (id->en) failures

- `masked-iden-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: '1) Lead the weekly community meeting in the main hall'
- `masked-iden-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: "2. prepares the foundation's financial reports at the end of every month."
- `masked-iden-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: 'Opening registration for the peace workshop for youth in Pati.'
- `masked-iden-04`:
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '4. Document community activities through photos and short videos.'
- `masked-iden-05`:
  - missing token 3 (Wiwit): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - raw hypothesis: '3. Answer messages received through the site every morning.'
- `masked-iden-06`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 1 (Petrus): expected 1, found 0
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '1 and 2 will represent 0 at the inter-community meeting in Semarang.'
- `masked-iden-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: '5 and 3 suggest that participants register before the 15th.'
- `masked-iden-08`:
  - missing token 2 (Nanik): expected 2, found 0
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 2, restored text has 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '2 asked 4 to archive photos of activities, then 2 checked them again.'
- `masked-iden-09`:
  - missing token 1 (Petrus): expected 2, found 0
  - name did not survive restoration: 'Petrus' expected 2, restored text has 0
  - raw hypothesis: 'According to 1, this program runs well since 1 became coordinator.'
- `masked-iden-10`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: 'Annual report 0 was written by 5 together with the mediation team.'

## qwen-mt-flash-masked-iden (id->en) failures

- `masked-iden-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: '1. Leading the community’s weekly meeting in the main hall.'
- `masked-iden-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '2. Preparing the foundation’s financial reports at the end of each month.'
- `masked-iden-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: '0 opened registration for a peace workshop for youth in Pati.'
- `masked-iden-04`:
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '4. Document community activities through photos and short videos.'
- `masked-iden-05`:
  - missing token 3 (Wiwit): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - raw hypothesis: '3. Respond to incoming messages via the website every morning.'
- `masked-iden-06`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 1 (Petrus): expected 1, found 0
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '1 and 2 will represent 0 at the inter-community meeting in Semarang.'
- `masked-iden-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: 'Sections 5 and 3 recommend that participants register before the 15th.'
- `masked-iden-08`:
  - missing token 2 (Nanik): expected 2, found 0
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 2, restored text has 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '2) request 4) to file the activity photos, then 2) review them again.'

## qwen-mt-plus-masked-enid (en->id) failures

- `masked-enid-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: '1) memimpin rapat mingguan komunitas di aula utama.'
- `masked-enid-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '2) menyiapkan laporan keuangan yayasan pada setiap akhir bulan.'
- `masked-enid-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: '(5) dan (3) menyarankan agar para peserta mendaftar sebelum tanggal 15.'

## qwen-mt-plus-masked-iden (id->en) failures

- `masked-iden-01`:
  - missing token 1 (Petrus): expected 1, found 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - raw hypothesis: '1. Lead the weekly community meeting in the main hall.'
- `masked-iden-02`:
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '(2) Preparing the foundation’s financial statements at the end of each month.'
- `masked-iden-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: 'It opened registration for a peace workshop for youth in Pati.'
- `masked-iden-04`:
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '(4) Document community activities through photos and short videos.'
- `masked-iden-05`:
  - missing token 3 (Wiwit): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - raw hypothesis: '(3) Respond to incoming messages via the website every morning.'
- `masked-iden-06`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 1 (Petrus): expected 1, found 0
  - missing token 2 (Nanik): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Petrus' expected 1, restored text has 0
  - name did not survive restoration: 'Nanik' expected 1, restored text has 0
  - raw hypothesis: '(1) and (2) will represent (0) at the inter-community meeting in Semarang.'
- `masked-iden-07`:
  - missing token 3 (Wiwit): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Wiwit' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: '(5) and (3) suggest that participants register before the 15th.'
- `masked-iden-08`:
  - missing token 2 (Nanik): expected 2, found 0
  - missing token 4 (Tito): expected 1, found 0
  - name did not survive restoration: 'Nanik' expected 2, restored text has 0
  - name did not survive restoration: 'Tito' expected 1, restored text has 0
  - raw hypothesis: '(2) request; (4) archive photos of the activities, then (2) review them again.'
- `masked-iden-10`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - missing token 5 (Ben): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - name did not survive restoration: 'Ben' expected 1, restored text has 0
  - raw hypothesis: 'The annual report for year 20__ was written by __ together with the mediation team.'

## qwen-mt-turbo-masked-iden (id->en) failures

- `masked-iden-03`:
  - missing token 0 (Peace Place Pati): expected 1, found 0
  - name did not survive restoration: 'Peace Place Pati' expected 1, restored text has 0
  - raw hypothesis: '0 opens registration for a peace workshop for youth in Pati.'
