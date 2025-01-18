const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const cors = require("cors");
const fs = require("fs");
const { google } = require("googleapis");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS
app.use(cors());

// OpenAI configuration
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multer configuration for file uploads
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Invalid file type"), false);
    }
    cb(null, true);
  },
});

// Google Drive OAuth2 client setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

// Helper functions for Google Drive
async function uploadFileToDrive(filePath, fileName) {
  const fileMetadata = { name: fileName };
  const media = { body: fs.createReadStream(filePath) };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: "id",
  });

  return response.data;
}

async function generatePublicUrl(fileId) {
  await drive.permissions.create({
    fileId: fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  const result = await drive.files.get({
    fileId,
    fields: "webViewLink, webContentLink",
  });
  console.log(result.data.mimeType);
  const directLink = `https://drive.google.com/uc?id=${fileId}`;

  return {
    directLink,
    fileName: result.data.name,
  };
}

async function deleteFileFromDrive(fileId) {
  const response = await drive.files.delete({ fileId });
  return response.status;
}

// API endpoints

app.post("/generate-text", express.json(), async (req, res) => {
  try {
    const { prompt } = req.body;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    res.json({ result: completion.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const uploadedFile = await uploadFileToDrive(file.path, file.originalname);
    const publicUrl = await generatePublicUrl(uploadedFile.id);

    fs.unlink(file.path, (err) => {
      if (err) console.error("Error deleting temporary file:", err);
    });

    res.json({ fileId: uploadedFile.id, url: publicUrl.directLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/delete/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const status = await deleteFileFromDrive(fileId);
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
