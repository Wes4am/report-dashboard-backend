// Enhanced API Server with POST endpoint for n8n/Zapier/Make.com
// File: server.js

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for your frontend
app.use(cors({
  origin: '*', // In production, specify your frontend domain
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json({ limit: '10mb' })); // Accept large payloads

// File path for storing campaign data
const DATA_FILE = path.join(__dirname, 'data', 'campaignData.json');

// In-memory cache
let campaignCache = null;
let lastCacheUpdate = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Ensure data directory exists
async function ensureDataDirectory() {
  const dataDir = path.join(__dirname, 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// Load campaign data from file
async function loadCampaignData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading campaign data:', error.message);
    // Return empty structure if file doesn't exist
    return { reports: [] };
  }
}

// Save campaign data to file
async function saveCampaignData(data) {
  try {
    await ensureDataDirectory();
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('✅ Campaign data saved successfully');
    return true;
  } catch (error) {
    console.error('❌ Error saving campaign data:', error);
    throw error;
  }
}

// ============================================
// GET ENDPOINTS (Frontend calls these)
// ============================================

// GET all campaign data
app.get('/api/campaigns', async (req, res) => {
  try {
    console.log('📥 GET /api/campaigns - Fetching all campaign data');
    
    // Check cache
    const now = Date.now();
    if (campaignCache && lastCacheUpdate && (now - lastCacheUpdate < CACHE_DURATION)) {
      console.log('✅ Returning cached data');
      return res.json(campaignCache);
    }

    // Load fresh data
    const data = await loadCampaignData();
    
    // Update cache
    campaignCache = data;
    lastCacheUpdate = now;
    
    console.log(`✅ Returning ${data.reports?.length || 0} reports`);
    res.json(data);
  } catch (error) {
    console.error('❌ Error fetching campaigns:', error);
    res.status(500).json({ 
      error: 'Failed to load campaign data',
      message: error.message 
    });
  }
});

// GET specific report
app.get('/api/campaigns/reports/:reportId', async (req, res) => {
  try {
    const data = await loadCampaignData();
    const report = data.reports.find(r => r.id === req.params.reportId);
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load report' });
  }
});

// ============================================
// POST ENDPOINTS (n8n/Zapier/Make call these)
// ============================================

// POST - Update all campaign data
// This is what n8n/Zapier/Make.com will call
app.post('/api/campaigns/update', async (req, res) => {
  try {
    console.log('📤 POST /api/campaigns/update - Receiving data update');
    
    const newData = req.body;
    
    // Validate structure
    if (!newData || !newData.reports || !Array.isArray(newData.reports)) {
      return res.status(400).json({ 
        error: 'Invalid data structure',
        expected: '{ reports: [...] }' 
      });
    }
    
    // Save to file
    await saveCampaignData(newData);
    
    // Clear cache so next GET request gets fresh data
    campaignCache = null;
    lastCacheUpdate = null;
    
    console.log(`✅ Updated ${newData.reports.length} reports successfully`);
    
    res.json({ 
      success: true,
      message: 'Campaign data updated successfully',
      reports: newData.reports.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error updating campaigns:', error);
    res.status(500).json({ 
      error: 'Failed to update campaign data',
      message: error.message 
    });
  }
});

// POST - Partial update (update specific report)
app.post('/api/campaigns/reports/:reportId/update', async (req, res) => {
  try {
    const reportId = req.params.reportId;
    const updatedReport = req.body;
    
    console.log(`📤 POST /api/campaigns/reports/${reportId}/update`);
    
    // Load existing data
    const data = await loadCampaignData();
    
    // Find and update the report
    const reportIndex = data.reports.findIndex(r => r.id === reportId);
    
    if (reportIndex === -1) {
      // Report doesn't exist, add it
      data.reports.push(updatedReport);
      console.log(`✅ Added new report: ${reportId}`);
    } else {
      // Update existing report
      data.reports[reportIndex] = updatedReport;
      console.log(`✅ Updated existing report: ${reportId}`);
    }
    
    // Save updated data
    await saveCampaignData(data);
    
    // Clear cache
    campaignCache = null;
    
    res.json({ 
      success: true,
      message: `Report ${reportId} updated successfully`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error updating report:', error);
    res.status(500).json({ 
      error: 'Failed to update report',
      message: error.message 
    });
  }
});

// POST - Manual cache refresh
app.post('/api/campaigns/refresh', async (req, res) => {
  try {
    console.log('🔄 POST /api/campaigns/refresh - Refreshing cache');
    
    const data = await loadCampaignData();
    campaignCache = data;
    lastCacheUpdate = Date.now();
    
    res.json({ 
      success: true,
      message: 'Cache refreshed successfully',
      reports: data.reports?.length || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to refresh cache',
      message: error.message 
    });
  }
});

// ============================================
// UTILITY ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache: {
      exists: !!campaignCache,
      age: lastCacheUpdate ? Date.now() - lastCacheUpdate : null
    }
  });
});

// Get API info
app.get('/api', (req, res) => {
  res.json({
    name: 'Campaign Architecture API',
    version: '1.0.0',
    endpoints: {
      get: {
        '/api/campaigns': 'Get all campaign data',
        '/api/campaigns/reports/:reportId': 'Get specific report',
        '/health': 'Health check'
      },
      post: {
        '/api/campaigns/update': 'Update all campaign data (from n8n/Zapier/Make)',
        '/api/campaigns/reports/:reportId/update': 'Update specific report',
        '/api/campaigns/refresh': 'Refresh cache manually'
      }
    },
    documentation: 'See API_USAGE.md for examples'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    available: [
      'GET /api/campaigns',
      'POST /api/campaigns/update',
      'GET /health'
    ]
  });
});

// Start server
app.listen(PORT, async () => {
  console.log('');
  console.log('🚀 Campaign Architecture API Server');
  console.log('=====================================');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`📋 API Info: http://localhost:${PORT}/api`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📥 Frontend GET endpoint:');
  console.log(`   http://localhost:${PORT}/api/campaigns`);
  console.log('');
  console.log('📤 n8n/Zapier/Make POST endpoint:');
  console.log(`   http://localhost:${PORT}/api/campaigns/update`);
  console.log('');
  console.log('✅ Ready to receive requests!');
  console.log('=====================================');
  
  // Ensure data directory exists on startup
  await ensureDataDirectory();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received, shutting down gracefully');
  process.exit(0);
});