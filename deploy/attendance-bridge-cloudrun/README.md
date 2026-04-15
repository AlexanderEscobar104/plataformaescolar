## Attendance Bridge for Cloud Run

This folder packages the attendance reader bridge as an isolated Cloud Run service.
It is configured for multitenant operation: each reader sends its own `token`, and the Cloud Function resolves the tenant from that token.

### Optional environment variables

- `ATTENDANCE_BRIDGE_TARGET`: base URL for the published attendance endpoint.
  Default: `https://us-central1-plataformaescolar-e0090.cloudfunctions.net/attendanceDevicePush`

### Local run

```bash
npm install
npm start
```

### Deploy to Cloud Run

```bash
gcloud run deploy attendance-device-bridge ^
  --source deploy/attendance-bridge-cloudrun ^
  --region us-central1 ^
  --allow-unauthenticated
```

After deployment, map your custom domain such as `api.tudominio.com` to this service.
