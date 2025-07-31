# 📧 Lead Capture Feature Documentation

## Overview

The lead capture feature automatically collects user information when they request an AI-generated travel itinerary. This enables the sales team to follow up with potential customers and convert them into paid travel planning services.

## ✨ Features

### 🔍 Lead Capture
- **Automatic Collection**: Captures lead data when users generate itineraries
- **Smart Prioritization**: Automatically assigns priority based on budget, group size, and duration
- **Duplicate Prevention**: Prevents duplicate leads for the same email address
- **Rich Metadata**: Stores IP address, user agent, referrer, and UTM parameters

### 📊 Lead Management
- **Comprehensive Dashboard**: Full-featured sales dashboard with filtering and sorting
- **Status Tracking**: Track lead status (new, contacted, qualified, converted, closed)
- **Priority Management**: High/Medium/Low priority classification
- **Export Capabilities**: Export leads to CSV or JSON for offline processing

### 🎯 Sales Tools
- **Contact Integration**: One-click email composition for lead follow-up
- **Statistics Dashboard**: Real-time analytics on lead performance
- **Filtering & Search**: Advanced filtering by status, priority, budget, destination
- **Lead History**: Complete audit trail of all lead interactions

## 🏗️ Implementation Details

### Backend Architecture

#### Data Model (`backend/src/models/Lead.ts`)
```typescript
interface Lead {
  id: string
  email: string
  name?: string
  phone?: string
  company?: string
  travelDetails: {
    destination: string
    originCity?: string
    departureDate?: string
    returnDate?: string
    duration: number
    budget: string
    groupSize: number
    interests?: string
    travelStyle?: string
  }
  leadSource: 'itinerary_generation'
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed'
  priority: 'high' | 'medium' | 'low'
  metadata: TrackingMetadata
  salesNotes?: string
  assignedToSalesRep?: string
  createdAt: Date
  updatedAt: Date
}
```

#### API Endpoints

**Public Endpoints:**
- `POST /api/v1/leads` - Create new lead (used by frontend forms)

**Protected Endpoints:**
- `GET /api/v1/leads` - Get leads with filtering and pagination
- `GET /api/v1/leads/:id` - Get specific lead details
- `PUT /api/v1/leads/:id` - Update lead information
- `GET /api/v1/leads/export/csv` - Export leads as CSV
- `GET /api/v1/leads/stats/overview` - Get lead statistics

#### Lead Service (`backend/src/services/leadService.ts`)
- **Firestore Integration**: Stores leads in GCP Firestore for scalability
- **Smart Prioritization**: Automatically calculates lead priority
- **Duplicate Detection**: Prevents duplicate leads by email
- **Export Functionality**: Supports JSON and CSV export formats

### Frontend Integration

#### Lead Capture Form
- **Seamless Integration**: Embedded within the itinerary generation form
- **Required Email**: Ensures all leads have contact information
- **Optional Fields**: Name, phone, company for lead qualification
- **Marketing Consent**: GDPR-compliant consent checkbox

#### Form Validation
```javascript
// Email validation before form submission
const contactEmail = formData.get('contactEmail');
if (!contactEmail || !contactEmail.includes('@')) {
    alert('📧 Please enter a valid email address to receive your itinerary');
    return;
}
```

#### Lead Capture Flow
1. User fills out travel itinerary form
2. User provides email (required) and optional contact details
3. Form submission triggers lead capture API call
4. Lead is stored in Firestore with travel preferences
5. Itinerary generation continues normally
6. User receives confirmation that their details were saved

### Sales Dashboard (`sales-dashboard.html`)

#### Key Features
- **Real-time Statistics**: Total leads, new leads, high priority, weekly count
- **Advanced Filtering**: By status, priority, budget, destination
- **Lead Export**: Download filtered leads as CSV or JSON
- **Contact Integration**: One-click email composition
- **Responsive Design**: Works on desktop and mobile devices

#### Dashboard Sections
1. **Statistics Cards**: Overview metrics
2. **Filter Controls**: Advanced filtering options
3. **Export Buttons**: Download leads for offline processing
4. **Lead Table**: Detailed lead information with actions

## 🚀 Getting Started

### 1. Backend Setup (Enterprise Version)

```bash
# Install dependencies
cd backend
npm install

# Configure environment variables
cp .env.example .env
# Add your Firestore credentials and config

# Start development server
npm run dev
```

### 2. Backend Setup (Simple Version)

The simple backend (`simple-backend.js`) includes in-memory lead storage for development:

```bash
# Start simple backend
node simple-backend.js
```

Access lead management endpoints:
- `GET /api/v1/leads/export` - Export leads as JSON or CSV
- `GET /api/v1/leads/stats` - View lead statistics

### 3. Frontend Usage

The lead capture form is automatically included in both:
- `frontend-app.html` (Simple version)
- `frontend/` (Enterprise React version)

### 4. Sales Team Access

Open `sales-dashboard.html` in a web browser to access the sales dashboard.

**Dashboard URL**: `file:///path/to/sales-dashboard.html`

## 📊 Lead Management Workflow

### 1. Lead Generation
- User visits travel planning website
- Fills out itinerary form with email address
- System automatically captures lead with travel preferences

### 2. Lead Qualification
- Sales team accesses dashboard
- Reviews lead priority (auto-assigned based on budget/group size)
- Filters leads by status, priority, destination

### 3. Follow-up Process
- Click "Contact" button to open pre-filled email
- Update lead status as: contacted → qualified → converted
- Add sales notes and assign to sales rep

### 4. Export & Analysis
- Export filtered leads to CSV for CRM import
- Analyze lead statistics and conversion patterns
- Track performance metrics

## 🔧 Configuration Options

### Lead Priority Calculation
```javascript
// High priority triggers
- Luxury budget
- Group size ≥ 5
- Duration ≥ 10 days

// Medium priority triggers  
- Moderate budget
- Group size ≥ 2
- Duration ≥ 5 days

// Default: Low priority
```

### Export Formats
- **JSON**: Complete lead data with metadata
- **CSV**: Flattened format for spreadsheet import

### Firestore Schema
```
Collection: leads
Document ID: auto-generated UUID
Fields: All lead properties with proper types
Indexes: email, status, priority, createdAt
```

## 🛡️ Security & Privacy

### Data Protection
- **Email Validation**: Server-side validation prevents invalid emails
- **Rate Limiting**: Prevents spam lead creation
- **GDPR Compliance**: Marketing consent checkbox
- **Data Encryption**: Firestore provides encryption at rest

### Access Control
- **Public Endpoints**: Only lead creation (POST /leads)
- **Protected Endpoints**: Lead management requires authentication
- **Sales Dashboard**: Client-side only (consider server-side auth for production)

## 📈 Analytics & Metrics

### Available Statistics
- Total leads captured
- New leads (uncontacted)
- High priority leads
- Recent leads (last 7 days)
- Conversion by status
- Distribution by budget/destination

### Export Capabilities
- **Filtered Exports**: Apply dashboard filters to exports
- **Date Range**: Export leads from specific time periods
- **Format Options**: CSV for spreadsheets, JSON for systems integration

## 🔮 Future Enhancements

### Planned Features
- **Email Automation**: Automatic follow-up sequences
- **CRM Integration**: Direct Salesforce/HubSpot sync
- **Lead Scoring**: ML-based lead quality scoring
- **A/B Testing**: Form optimization experiments
- **Real-time Notifications**: Slack/Teams integration for new high-priority leads

### Technical Improvements
- **Lead Deduplication**: Advanced duplicate detection
- **Data Enrichment**: Automatic company/contact info enhancement
- **Pipeline Analytics**: Conversion funnel analysis
- **Mobile App**: Native mobile dashboard

## 📞 Support

For technical support or feature requests:
- Create GitHub issues for bugs/enhancements
- Check API documentation at `/api/docs`
- Review logs in GCP Console for Firestore operations

## 🎉 Success Metrics

Track these KPIs to measure lead capture success:
- **Conversion Rate**: Form submissions to lead capture
- **Lead Quality**: Priority distribution and follow-up success
- **Sales Impact**: Leads converted to customers
- **Export Usage**: Sales team dashboard adoption