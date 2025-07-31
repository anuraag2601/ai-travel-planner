export interface Lead {
  id: string
  email: string
  name?: string
  phone?: string
  company?: string
  
  // Travel details that triggered the lead
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
  
  // Lead qualification data
  leadSource: 'itinerary_generation' | 'newsletter_signup' | 'contact_form'
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed'
  priority: 'high' | 'medium' | 'low'
  
  // Tracking metadata
  metadata: {
    ipAddress?: string
    userAgent?: string
    referrer?: string
    sessionId?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
  }
  
  // Sales follow-up data
  salesNotes?: string
  lastContactedAt?: Date
  nextFollowUpAt?: Date
  assignedToSalesRep?: string
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}

export interface LeadCreateRequest {
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
  metadata?: {
    ipAddress?: string
    userAgent?: string
    referrer?: string
    sessionId?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
  }
}

export interface LeadUpdateRequest {
  name?: string
  phone?: string
  company?: string
  status?: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed'
  priority?: 'high' | 'medium' | 'low'
  salesNotes?: string
  lastContactedAt?: Date
  nextFollowUpAt?: Date
  assignedToSalesRep?: string
}

export interface LeadExportData {
  id: string
  email: string
  name?: string
  phone?: string
  company?: string
  destination: string
  budget: string
  groupSize: number
  status: string
  priority: string
  createdAt: string
  lastContactedAt?: string
  nextFollowUpAt?: string
  assignedToSalesRep?: string
  salesNotes?: string
}

export interface LeadListQuery {
  page?: number
  limit?: number
  status?: string
  priority?: string
  destination?: string
  budget?: string
  assignedToSalesRep?: string
  createdAfter?: string
  createdBefore?: string
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'nextFollowUpAt'
  sortOrder?: 'asc' | 'desc'
}