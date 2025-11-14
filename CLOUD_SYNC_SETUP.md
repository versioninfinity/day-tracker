# Cloud Sync Setup Guide

Your Day Tracker now has cloud backup capabilities! Follow these steps to enable automatic syncing to Vercel.

## Step 1: Deploy the API to Vercel

### 1.1 Install Vercel CLI

```bash
npm install -g vercel
```

### 1.2 Navigate to the API project

```bash
cd ../day-tracker-api
```

### 1.3 Deploy to Vercel

```bash
vercel
```

Follow the prompts:
- **Login** to your Vercel account (or create one)
- **Set up project**: Yes
- **Project name**: day-tracker-api (or your preference)
- **Which scope**: Choose your account
- **Link to existing project**: No
- **Project path**: ./
- **Override settings**: No

### 1.4 Add Vercel KV Database

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click on your `day-tracker-api` project
3. Go to the **"Storage"** tab
4. Click **"Create Database"**
5. Select **"KV"** (Redis)
6. Name it: `day-tracker-sessions`
7. Click **"Create"**
8. The database will automatically link to your project

### 1.5 Deploy to Production

```bash
vercel --prod
```

After deployment, you'll see a URL like:
```
https://day-tracker-api-xxxx.vercel.app
```

**Copy this URL!** You'll need it in the next step.

## Step 2: Enable Cloud Sync in Your App

### 2.1 Update the API URL

Open `/Users/zaragoel/day-tracker/src/components/SimpleCalendar.tsx`

Find these lines near the top (around line 7-9):

```typescript
const CLOUD_API_URL = 'https://your-api-url.vercel.app/api/sessions';
const ENABLE_CLOUD_SYNC = false;
```

Replace with your actual Vercel URL:

```typescript
const CLOUD_API_URL = 'https://day-tracker-api-xxxx.vercel.app/api/sessions';
const ENABLE_CLOUD_SYNC = true; // Enable cloud sync
```

### 2.2 Save and Restart

Save the file. The app will automatically reload and start syncing to the cloud!

## How It Works

### Automatic Syncing
- **Every change** you make (create, edit, delete sessions) automatically backs up to Vercel
- Data is stored in Vercel KV (Redis) - fast and reliable
- Local storage (browser) is still used as primary storage
- Cloud acts as a backup

### Data Storage
- **Local**: Browser localStorage (immediate access)
- **Cloud**: Vercel KV (backup, accessible from anywhere)

### Console Messages
Check your browser console (Right-click → Inspect → Console) to see:
- ✅ "Synced to cloud successfully" - when backup completes
- ❌ "Cloud sync error" - if there's a problem (won't affect your local data)

## Testing

1. Create a new session in your app
2. Check the browser console - you should see "✅ Synced to cloud successfully"
3. Visit your API directly in browser: `https://your-url.vercel.app/api/sessions`
4. You should see your sessions JSON

## Troubleshooting

### "Cloud sync error" messages
- Check that `CLOUD_API_URL` is correct
- Make sure you deployed to production (`vercel --prod`)
- Verify the KV database is linked in Vercel dashboard

### Data not syncing
- Check that `ENABLE_CLOUD_SYNC = true`
- Open browser console to see error messages
- Try redeploying the API: `cd ../day-tracker-api && vercel --prod`

## Future Enhancements

You can extend this setup to:
- Load data from cloud on startup (useful across devices)
- Add user authentication (different users, different data)
- Export data as JSON
- Share sessions between devices

Need help? Check the API readme at `/Users/zaragoel/day-tracker-api/README.md`
