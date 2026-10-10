# Cloud CAD engine (P5-11)

AI-written CadQuery code is turned into STEP + STL + a preview picture on a small private server in Doha (Google Cloud Run, region `me-central1`). The browser OpenSCAD path stays as the fallback. A switch decides who uses which path. While it is set to `browser`, nothing changes for clients.

## How it fits together

```
Workspace "3D model" card
   │  POST /api/cad
   ▼
Next.js (Vercel)  ── lib/cad/engine.ts: which engine? (store_settings.cad_engine + role)
   │  cloud:
   │   1. Gemini writes CadQuery (lib/cad/prompt.ts, checked by lib/cad/validate.ts)
   │   2. lib/cad/cloud.ts mints a Google ID token WITHOUT a key file:
   │      Vercel OIDC token → Google STS (Workload Identity Federation)
   │      → IAM Credentials generateIdToken as vercel-cad-caller
   │      and POSTs {code, checks} to GCP_CAD_URL/build (60 s)
   ▼
Cloud Run "cad-worker" (services/cad-worker, private, IAM: run.invoker only)
   │  sandbox: AST allow-list → child process (45 s, CPU/memory/file limits,
   │  temp dir, no sockets) → CadQuery → checks → STEP/STL/SVG
   ▼
Next.js stores the files in cad-files/<user>/<project>/cad/<id>.{step,stl,svg,json},
then calls cad_deliver (the credit is spent only now).
```

- **Checks** (plain words to the client, full detail in Engineer view):
  - one valid closed solid
  - volume above 0
  - the outside size
  - the board fits inside (`must_contain_box`, from the project's largest known board, height 12 mm)
  - walls at least 1.2 mm (`min_wall_mm` in the setting)
- **A failed check:** the worker's messages are fed into one automatic repair. If it still fails, nothing is delivered and nothing is charged.
- **Worker down or timing out twice, no Google token (STS / IAM refused or timed out, 10 s each), or env missing:** the request falls back to the browser OpenSCAD path. An `ai_usage` row is logged with provider `cad-worker` and error code `fallback_browser:<reason>`, visible on Dashboard → AI usage.
- **Credits are unchanged:**
  - 1 CAD credit covers up to 3 versions.
  - The credit is charged only when the first result is delivered.
  - Failed builds never charge.
  - The 24 h cap still applies.

## The switch

`store_settings.cad_engine` (migration 0067):

| Value | Who uses the cloud worker |
|---|---|
| `{"engine": "browser", "min_wall_mm": 1.2}` | nobody (default) |
| `{"engine": "admin", "min_wall_mm": 1.2}` | super_admin only (your account) |
| `{"engine": "cloud", "min_wall_mm": 1.2}` | everyone |

```sql
update public.store_settings set value = '{"engine": "admin", "min_wall_mm": 1.2}'::jsonb where key = 'cad_engine';
```
Then press any Dashboard → Store save (refreshes the cached setting). **Turn off:** set `"engine": "browser"` the same way.

## Deploy (one time)

Run these from the repo root in PowerShell or Git Bash. Replace `PROJECT` with the project id and `BILLING` with the billing account id. Nothing here is a subscription: Cloud Run, Cloud Build and Artifact Registry are pay-as-you-go with free tiers, and the budget alerts below warn at USD 1, 5 and 10.

```bash
gcloud auth login
gcloud config set project PROJECT
```

1. **Project and APIs** (skip creating the project if one already exists):
   ```bash
   gcloud projects create PROJECT --name="Gestaltung CAD"
   gcloud billing projects link PROJECT --billing-account=BILLING
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com iam.googleapis.com billingbudgets.googleapis.com
   ```
2. **Image repository and build.** The build runs every worker test, CadQuery ones included, and pushes nothing if a test fails.
   ```bash
   gcloud artifacts repositories create gestaltung --repository-format=docker --location=me-central1
   gcloud builds submit services/cad-worker --config services/cad-worker/cloudbuild.yaml --substitutions=_REGION=me-central1,_REPO=gestaltung
   ```
3. **Runtime identity with no roles, then the private service.** Pick any long random string for the shared token.
   ```bash
   gcloud iam service-accounts create cad-worker-runtime --display-name="CAD worker runtime (no roles)"
   gcloud run deploy cad-worker --image=me-central1-docker.pkg.dev/PROJECT/gestaltung/cad-worker:latest --region=me-central1 --no-allow-unauthenticated --service-account=cad-worker-runtime@PROJECT.iam.gserviceaccount.com --cpu=2 --memory=2Gi --concurrency=1 --timeout=60 --min-instances=0 --max-instances=2 --set-env-vars=CAD_WORKER_TOKEN=CHOOSE_A_LONG_RANDOM_STRING
   ```
4. **The caller Vercel uses — keyless.** The Google organisation blocks service-account keys (`constraints/iam.disableServiceAccountKeyCreation`), so Vercel proves who it is with its own OIDC token and Google swaps it for a short-lived ID token (Workload Identity Federation). There is no key file anywhere.
   ```bash
   gcloud iam service-accounts create vercel-cad-caller --display-name="Vercel CAD caller"
   gcloud run services add-iam-policy-binding cad-worker --region=me-central1 --member=serviceAccount:vercel-cad-caller@gestaltung-cad.iam.gserviceaccount.com --role=roles/run.invoker
   gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project=gestaltung-cad
   gcloud iam workload-identity-pools create vercel --location=global --display-name="Vercel" --project=gestaltung-cad
   gcloud iam workload-identity-pools providers create-oidc vercel --workload-identity-pool=vercel --location=global --issuer-uri=https://oidc.vercel.com/gestaltungco-7345s-projects --allowed-audiences=https://vercel.com/gestaltungco-7345s-projects --attribute-mapping="google.subject=assertion.sub,attribute.project=assertion.project,attribute.environment=assertion.environment" --attribute-condition="assertion.project=='gestaltung' && (assertion.environment=='production' || assertion.environment=='development')" --project=gestaltung-cad
   gcloud iam service-accounts add-iam-policy-binding vercel-cad-caller@gestaltung-cad.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/1005108288584/locations/global/workloadIdentityPools/vercel/attribute.project/gestaltung" --project=gestaltung-cad
   gcloud iam service-accounts add-iam-policy-binding vercel-cad-caller@gestaltung-cad.iam.gserviceaccount.com --role=roles/iam.serviceAccountOpenIdTokenCreator --member="principalSet://iam.googleapis.com/projects/1005108288584/locations/global/workloadIdentityPools/vercel/attribute.project/gestaltung" --project=gestaltung-cad
   ```
   - The provider only accepts tokens of the Vercel project `gestaltung`, environments `production` and `development` (Preview is refused; add it to the condition if you want it).
   - Vercel side: Team Settings → Security → "Secure backend access with OIDC federation" must be on, Team issuer mode (`https://oidc.vercel.com/gestaltungco-7345s-projects`). It already is.
   - IAM changes can take a couple of minutes to work.
5. **Vercel env** (Production; Development too for local runs). All server-only:

   | Name | Value |
   |---|---|
   | `GCP_CAD_URL` | `https://cad-worker-1005108288584.me-central1.run.app` |
   | `GCP_WIF_PROVIDER` | `projects/1005108288584/locations/global/workloadIdentityPools/vercel/providers/vercel` |
   | `GCP_CAD_SA_EMAIL` | `vercel-cad-caller@gestaltung-cad.iam.gserviceaccount.com` |
   | `CAD_WORKER_TOKEN` | the same string as in step 3 |

   ```bash
   vercel env add GCP_CAD_URL production
   vercel env add GCP_WIF_PROVIDER production
   vercel env add GCP_CAD_SA_EMAIL production
   vercel env add CAD_WORKER_TOKEN production
   ```
   Redeploy after adding them. The Vercel OIDC token itself needs no env: on Vercel it arrives with every request (header `x-vercel-oidc-token`); locally `vercel env pull` writes a `VERCEL_OIDC_TOKEN` (valid about 12 hours, pull again when it expires).

   *Legacy:* `GCP_CAD_SA_KEY` (a key JSON, raw or base64) still works when `GCP_WIF_PROVIDER` / `GCP_CAD_SA_EMAIL` are not set. Keyless always wins when both are set.
6. **Budget alerts** (emails go to the billing account's admins):
   ```bash
   gcloud billing budgets create --billing-account=BILLING --display-name="CAD worker" --budget-amount=10USD --threshold-rule=percent=0.1 --threshold-rule=percent=0.5 --threshold-rule=percent=1.0
   ```
7. **Run migration 0067 and set the switch to `admin`** (see above).

**Check it is alive.** `/health` needs a token too, because the service is private:
```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://<GCP_CAD_URL>/health
```

## Update the worker

Repeat step 2. Then:
```bash
gcloud run deploy cad-worker --image=me-central1-docker.pkg.dev/PROJECT/gestaltung/cad-worker:latest --region=me-central1
```

## Rotate the caller key

Nothing to rotate: the keyless setup has no key. Each ID token lives about an hour and is minted fresh from the Vercel OIDC token. To cut Vercel off, remove the two `principalSet` bindings from step 4 (or disable the `vercel` provider).

## Read the costs

Cloud Console → Billing → Reports, filtered to the project. Cloud Run → cad-worker → Metrics shows requests, time and memory. With `min-instances 0` there is no cost while nobody builds. Each build is a few seconds of 2 vCPU / 2 GiB and stays inside the free tier at our volume. The image costs a few cents a month in Artifact Registry storage.

## Turn it off

- **Clients:** set `cad_engine` back to `"browser"` (instant after a Dashboard → Store save).
- **Stop the service completely:**
  ```bash
  gcloud run services delete cad-worker --region=me-central1
  ```
