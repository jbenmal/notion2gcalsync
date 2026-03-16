# Notion ↔ Google Calendar Bidirectional Sync

A 100% free, serverless, bidirectional synchronization system between a Notion Database and Google Calendar. This integration runs entirely on Google Apps Script, requiring zero paid middleware (no Zapier, Make.com, or paid servers). Gemini was used through the 100% development of this integration.

## 🏗 Architecture & Logic

This system uses a **Time-Driven Trigger** in Google Apps Script to poll both APIs at regular intervals. 

To prevent infinite loops, duplicate events, and data loss, the sync strictly enforces the following rules:
* **ID Mapping:** Every synced Notion page stores the `gcal_event_id` in a hidden text property. Every synced GCal event stores the `notion_page_id` in its `extendedProperties`.
* **Conflict Resolution:** The system uses Notion's `last_edited_time` and Google Calendar's `updated` timestamps as the absolute source of truth. Whichever platform was updated most recently wins and overwrites the other.
* **Create Once, Sync Everywhere:** New events created in either platform are automatically pushed to the other during the next execution cycle.
* **Updateable Events:** Changes to titles, dates, or times edit the existing mapped event. 

## 📋 Prerequisites

* A Google Account (for Google Calendar and Google Apps Script).
* A Notion workspace with Admin or Workspace Owner access.
* Zero dollars ($0.00).

## 🚀 Setup Phases

1.  **Notion Database Configuration:** Setup the required properties (Title, Date, `gcal_event_id`, and `last_edited_time`).
2.  **API Provisioning:** Generate a Notion Internal Integration Token and share the target database with the integration.
3.  **Google Apps Script Setup:** Create a `.gs` project, link the Google Calendar Advanced Service, paste the content of `main.gs` and securely store the Notion API key in Script Properties.
4.  **Deployment:** Deploy the codebase and configure the Time-Driven Triggers (e.g., every 5 to 15 minutes).

## 🛠 Troubleshooting

If the sync fails, check the **Executions** tab in your Google Apps Script dashboard. Ensure that:
* The Notion Integration has been explicitly invited to the database page.
* The `Notion API Token` and `Database ID` are correct in the Script Properties.
* You have not exceeded Google's daily URL Fetch quotas (highly unlikely for standard personal use).
