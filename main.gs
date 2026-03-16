// --- SUBJECT TO EMOJI MAPPING ---
// This acts as a routing table. Update this whenever you change semesters/subjects.
const ASIGNATURA_EMOJIS = {
  // Add your emojis related to your Notion database Asignatura (my case) property. Some examples:
  "Entrepreneurship": "🦈",
  "ATO": "✈️",
  "AOM": "💫",
  "Aeroelasticity": "🌪",
  "OATA": "🛫",
  "Composites": "🧱",
  
};
const DEFAULT_EMOJI = ""; // Fallback if the subject doesn't match or is empty

// --- G-CAL DISCLAIMER ---
const EVENT_DISCLAIMER = "\n\n---\n🔄 Synced automatically from Notion. Edits to the time/date will sync back!";



// --- CONFIGURATION ---
const NOTION_API_KEY = 'introduce_your_key';
const NOTION_DATABASE_ID = 'introduce_your_key';
const CALENDAR_ID = 'introduce_your_key'; // Use 'primary' or a specific Calendar ID from settings

// Headers for Notion API
const NOTION_HEADERS = {
  "Authorization": "Bearer " + NOTION_API_KEY,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28"
};

function testConnection() {
  Logger.log("Environment initialized. Ready for sync logic.");
}

/**
 * Fetches updated Notion pages and syncs them to Google Calendar.
 */
function syncNotionToGCal() {
  const url = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`;
  
  const payload = {
    filter: {
      timestamp: "last_edited_time",
      last_edited_time: {
        after: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      }
    }
  };

  const options = {
    method: "post",
    headers: NOTION_HEADERS,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());

  if (data.results) {
    data.results.forEach(page => {
      const props = page.properties;
      const rawTitle = props["Name"].title[0]?.plain_text || "Untitled Event";
      const dateProp = props["Date"].date;
      const gcalEventId = props["GCal Event ID"].rich_text[0]?.plain_text;
      
      // --- EMOJI EXTRACTOR LOGIC ---
      // Checks if 'Asignatura' is a Select property, or falls back to Text property
      let asignaturaName = "";
      if (props["Asignatura"]) {
        asignaturaName = props["Asignatura"].select?.name 
                      || props["Asignatura"].rich_text?.[0]?.plain_text 
                      || "";
      }
      
      // Look up the emoji, default to the calendar icon if not found
      const emoji = ASIGNATURA_EMOJIS[asignaturaName] || DEFAULT_EMOJI;
      // Clean the Notion title first, THEN apply the correct emoji
      const cleanRawTitle = stripEmojiFromTitle(rawTitle);
      const finalTitle = `${emoji} ${cleanRawTitle}`.trim(); // Added a space for cleaner formatting!
      // -----------------------------

      if (!dateProp) return;

      const eventDetails = { 
        summary: finalTitle,
        description: EVENT_DISCLAIMER // <--- DISCLAIMER ADDED HERE
      };
      
      const isFullDay = !dateProp.start.includes("T");

      if (isFullDay) {
        eventDetails.start = { date: dateProp.start };
        eventDetails.end = { date: dateProp.end || dateProp.start };
      } else {
        eventDetails.start = { dateTime: dateProp.start };
        eventDetails.end = { dateTime: dateProp.end || dateProp.start };
      }

      if (gcalEventId) {
        try {
          Calendar.Events.patch(eventDetails, CALENDAR_ID, gcalEventId);
          Logger.log(`Updated: ${finalTitle}`);
        } catch (e) {
          Logger.log(`Update failed for ${finalTitle}: ${e}`);
        }
      } else {
        try {
          const newEvent = Calendar.Events.insert(eventDetails, CALENDAR_ID);
          updateNotionWithGCalId(page.id, newEvent.id);
          Logger.log(`Created: ${finalTitle}`);
        } catch (e) {
          Logger.log(`Insert failed for ${finalTitle}: ${e}`);
        }
      }
    });
  }
}

/**
 * Fetches updated GCal events and syncs them back to Notion.
 */
function syncGCalToNotion() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  
  // Fetch events modified in the last 24 hours
  const events = Calendar.Events.list(CALENDAR_ID, {
    updatedMin: yesterday.toISOString(),
    showDeleted: true,
    singleEvents: true,
    orderBy: 'updated'
  });

  if (events.items && events.items.length > 0) {
    events.items.forEach(event => {
      const gcalEventId = event.id;
      const gcalUpdated = new Date(event.updated);
      
      // 1. Check if this GCal event already exists in Notion
      const notionPage = findNotionPageByGCalId(gcalEventId);

      if (notionPage) {
      // --- DELETION LOGIC ---
        if (event.status === "cancelled") {
          if (!notionPage.archived) {
            archiveNotionPage(notionPage.id);
            Logger.log(`🗑️ GCal → Notion: Archived page for deleted event ID: ${gcalEventId}`);
          }
          return; // Stop processing this event
        }
        // ----------------------
        const notionLastEdited = new Date(notionPage.last_edited_time);

        // 2. Conflict Resolution: Only update Notion if GCal is newer
        if (gcalUpdated > notionLastEdited) {
          updateNotionPage(notionPage.id, event);
          Logger.log(`GCal → Notion: Updated "${event.summary}"`);
        }
      } else {
        // --- NEW CREATION LOGIC ---
        // We only create a page if the event IS NOT cancelled 
        // (we don't want to create pages for ghosts of deleted GCal events)
        if (event.status !== "cancelled") {
          createNotionPage(event);
          Logger.log(`✨ GCal → Notion: Created new page for "${event.summary}"`);
        } else {
          Logger.log(`Skipping deleted GCal event not found in Notion.`);
        }
        // --------------------------
      }
    });
  }
}

/**
 * Helper: Find Notion page using the GCal Event ID
 */
function findNotionPageByGCalId(gcalEventId) {
  const url = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`;
  const payload = {
    filter: {
      property: "GCal Event ID",
      rich_text: { equals: gcalEventId }
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    headers: NOTION_HEADERS,
    payload: JSON.stringify(payload)
  });
  
  const data = JSON.parse(response.getContentText());
  return data.results.length > 0 ? data.results[0] : null;
}

/**
 * Helper: Update the Notion page with GCal data
 */
function updateNotionPage(pageId, event) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  
  // Format dates for Notion
  const start = event.start.dateTime || event.start.date;
  const end = event.end.dateTime || event.end.date;
  // CLEAN THE GCAL TITLE BEFORE WRITING TO NOTION
  const cleanSummary = stripEmojiFromTitle(event.summary || "Untitled");
  const payload = {
    properties: {
      "Name": { title: [{ text: { content: cleanSummary } }] }, // Used cleanSummary
      "Date": { date: { start: start, end: end === start ? null : end } }
    }
  };

  UrlFetchApp.fetch(url, {
    method: "patch",
    headers: NOTION_HEADERS,
    payload: JSON.stringify(payload)
  });
}



/**
 * Helper to write the GCal ID back to the Notion page.
 */
function updateNotionWithGCalId(pageId, eventId) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    properties: {
      "GCal Event ID": {
        rich_text: [{ text: { content: eventId } }]
      }
    }
  };
  
  UrlFetchApp.fetch(url, {
    method: "patch",
    headers: NOTION_HEADERS,
    payload: JSON.stringify(payload)
  });
}

/**
 * Helper: Archives (deletes) a Notion page
 */
function archiveNotionPage(pageId) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    archived: true
  };

// Define the options variable here!
  const options = {
    method: "patch",
    headers: NOTION_HEADERS,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // Prevents the script from crashing if Notion says no
  };
  const response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() !== 200) {
    Logger.log(`⚠️ Failed to archive Notion page. Check API permissions! Error: ${response.getContentText()}`);
  }
}


// --- END CONFIGURATION ---

/**
 * Helper: Removes our dictionary emojis from the start of a title to prevent duplication.
 */
function stripEmojiFromTitle(title) {
  let cleanTitle = title.trim();
  const allEmojis = Object.values(ASIGNATURA_EMOJIS);
  if (DEFAULT_EMOJI) allEmojis.push(DEFAULT_EMOJI); // Include fallback if it exists
  
  allEmojis.forEach(emoji => {
    if (emoji && cleanTitle.startsWith(emoji)) {
      // Slices off the emoji and removes any trailing spaces
      cleanTitle = cleanTitle.substring(emoji.length).trim(); 
    }
  });
  
  return cleanTitle;
}

/**
 * Helper: Creates a new Notion page from a GCal event
 */
function createNotionPage(event) {
  const url = 'https://api.notion.com/v1/pages';

  const rawTitle = event.summary || "Untitled Event";
  
  // 1. Detect the subject from the emoji
  const detectedSubject = getSubjectFromTitle(rawTitle);
  
  // 2. Clean the title for Notion (strip the emoji)
  const cleanSummary = stripEmojiFromTitle(rawTitle);

  // Format dates for Notion
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  
  // Build the base properties
  const properties = {
    "Name": { title: [{ text: { content: cleanSummary } }] },
    "Date": { date: { start: start, end: end === start ? null : end } },
    "GCal Event ID": { rich_text: [{ text: { content: event.id } }] }
  };

  // 3. If a subject was detected, add it to the Notion properties
  // Note: This assumes "Asignatura" is a 'Select' property in Notion. 
  if (detectedSubject) {
    properties["Asignatura"] = { select: { name: detectedSubject } };
  }

  const payload = {
    parent: { database_id: NOTION_DATABASE_ID },
    properties: properties
  };

  const options = {
    method: "post",
    headers: NOTION_HEADERS,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() !== 200) {
    Logger.log(`⚠️ Failed to create Notion page. Error: ${response.getContentText()}`);
  }
}

/**
 * Helper: Detects the subject based on the emoji at the start of a GCal title
 */
function getSubjectFromTitle(title) {
  const cleanTitle = title.trim();
  
  // Loop through our dictionary to find a matching emoji
  for (const [subject, emoji] of Object.entries(ASIGNATURA_EMOJIS)) {
    if (emoji && cleanTitle.startsWith(emoji)) {
      return subject; // Found a match, return the subject name!
    }
  }
  
  return null; // No match found
}

/**
 * Master function to run both sync directions.
 */
function runMasterSync() {
  Logger.log("--- Starting Notion to GCal Sync ---");
  syncNotionToGCal();
  
  Logger.log("--- Starting GCal to Notion Sync ---");
  syncGCalToNotion();
  
  Logger.log("--- Sync Complete ---");
}

