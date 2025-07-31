import { v4 as uuidv4 } from 'uuid'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from '@/utils/logger.js'
import { Lead, LeadCreateRequest, LeadUpdateRequest, LeadListQuery, LeadExportData } from '@/models/Lead.js'

const db = getFirestore()
const LEADS_COLLECTION = 'leads'

export class LeadService {
  /**
   * Create a new lead
   */
  static async createLead(data: LeadCreateRequest): Promise<Lead> {
    try {
      const leadId = uuidv4()
      const now = new Date()
      
      const lead: Lead = {
        id: leadId,
        email: data.email.toLowerCase().trim(),
        name: data.name?.trim(),
        phone: data.phone?.trim(),
        company: data.company?.trim(),
        travelDetails: data.travelDetails,
        leadSource: 'itinerary_generation',
        status: 'new',
        priority: this.calculatePriority(data),
        metadata: data.metadata || {},
        createdAt: now,
        updatedAt: now
      }

      // Save to Firestore
      await db.collection(LEADS_COLLECTION).doc(leadId).set({
        ...lead,
        createdAt: Timestamp.fromDate(lead.createdAt),
        updatedAt: Timestamp.fromDate(lead.updatedAt)
      })

      logger.info('Lead created successfully', { leadId, email: lead.email })
      return lead
      
    } catch (error) {
      logger.error('Failed to create lead:', error)
      throw new Error('Failed to create lead')
    }
  }

  /**
   * Get lead by ID
   */
  static async getLeadById(leadId: string): Promise<Lead | null> {
    try {
      const doc = await db.collection(LEADS_COLLECTION).doc(leadId).get()
      
      if (!doc.exists) {
        return null
      }

      const data = doc.data()!
      return this.convertFirestoreToLead(data)
      
    } catch (error) {
      logger.error('Failed to get lead by ID:', error)
      throw new Error('Failed to retrieve lead')
    }
  }

  /**
   * Check if lead already exists by email
   */
  static async getLeadByEmail(email: string): Promise<Lead | null> {
    try {
      const snapshot = await db.collection(LEADS_COLLECTION)
        .where('email', '==', email.toLowerCase().trim())
        .limit(1)
        .get()

      if (snapshot.empty) {
        return null
      }

      const doc = snapshot.docs[0]
      return this.convertFirestoreToLead(doc.data())
      
    } catch (error) {
      logger.error('Failed to get lead by email:', error)
      throw new Error('Failed to retrieve lead')
    }
  }

  /**
   * Update lead
   */
  static async updateLead(leadId: string, updates: LeadUpdateRequest): Promise<Lead> {
    try {
      const leadRef = db.collection(LEADS_COLLECTION).doc(leadId)
      const doc = await leadRef.get()
      
      if (!doc.exists) {
        throw new Error('Lead not found')
      }

      const updateData = {
        ...updates,
        updatedAt: Timestamp.fromDate(new Date())
      }

      // Convert dates to Firestore timestamps
      if (updates.lastContactedAt) {
        updateData.lastContactedAt = Timestamp.fromDate(updates.lastContactedAt)
      }
      if (updates.nextFollowUpAt) {
        updateData.nextFollowUpAt = Timestamp.fromDate(updates.nextFollowUpAt)
      }

      await leadRef.update(updateData)

      // Get updated lead
      const updatedDoc = await leadRef.get()
      const updatedLead = this.convertFirestoreToLead(updatedDoc.data()!)

      logger.info('Lead updated successfully', { leadId })
      return updatedLead
      
    } catch (error) {
      logger.error('Failed to update lead:', error)
      throw new Error('Failed to update lead')
    }
  }

  /**
   * Get leads with filtering and pagination
   */
  static async getLeads(query: LeadListQuery = {}): Promise<{
    leads: Lead[]
    total: number
    page: number
    limit: number
    hasMore: boolean
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        status,
        priority,
        destination,
        budget,
        assignedToSalesRep,
        createdAfter,
        createdBefore,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = query

      let firestoreQuery = db.collection(LEADS_COLLECTION) as any

      // Apply filters
      if (status) {
        firestoreQuery = firestoreQuery.where('status', '==', status)
      }
      if (priority) {
        firestoreQuery = firestoreQuery.where('priority', '==', priority)
      }
      if (destination) {
        firestoreQuery = firestoreQuery.where('travelDetails.destination', '==', destination)
      }
      if (budget) {
        firestoreQuery = firestoreQuery.where('travelDetails.budget', '==', budget)
      }
      if (assignedToSalesRep) {
        firestoreQuery = firestoreQuery.where('assignedToSalesRep', '==', assignedToSalesRep)
      }
      if (createdAfter) {
        firestoreQuery = firestoreQuery.where('createdAt', '>=', Timestamp.fromDate(new Date(createdAfter)))
      }
      if (createdBefore) {
        firestoreQuery = firestoreQuery.where('createdAt', '<=', Timestamp.fromDate(new Date(createdBefore)))
      }

      // Apply sorting
      firestoreQuery = firestoreQuery.orderBy(sortBy, sortOrder)

      // Apply pagination
      const offset = (page - 1) * limit
      firestoreQuery = firestoreQuery.limit(limit + 1).offset(offset)

      const snapshot = await firestoreQuery.get()
      const hasMore = snapshot.docs.length > limit
      const leads = snapshot.docs
        .slice(0, limit)
        .map((doc: any) => this.convertFirestoreToLead(doc.data()))

      // Get total count for the query (without pagination)
      let countQuery = db.collection(LEADS_COLLECTION) as any
      if (status) countQuery = countQuery.where('status', '==', status)
      if (priority) countQuery = countQuery.where('priority', '==', priority)
      if (destination) countQuery = countQuery.where('travelDetails.destination', '==', destination)
      if (budget) countQuery = countQuery.where('travelDetails.budget', '==', budget)
      if (assignedToSalesRep) countQuery = countQuery.where('assignedToSalesRep', '==', assignedToSalesRep)
      if (createdAfter) countQuery = countQuery.where('createdAt', '>=', Timestamp.fromDate(new Date(createdAfter)))
      if (createdBefore) countQuery = countQuery.where('createdAt', '<=', Timestamp.fromDate(new Date(createdBefore)))

      const countSnapshot = await countQuery.get()
      const total = countSnapshot.size

      return {
        leads,
        total,
        page,
        limit,
        hasMore
      }
      
    } catch (error) {
      logger.error('Failed to get leads:', error)
      throw new Error('Failed to retrieve leads')
    }
  }

  /**
   * Get leads for export (all matching criteria)
   */
  static async getLeadsForExport(query: LeadListQuery = {}): Promise<LeadExportData[]> {
    try {
      const {
        status,
        priority,
        destination,
        budget,
        assignedToSalesRep,
        createdAfter,
        createdBefore,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = query

      let firestoreQuery = db.collection(LEADS_COLLECTION) as any

      // Apply filters (same as getLeads but without pagination)
      if (status) {
        firestoreQuery = firestoreQuery.where('status', '==', status)
      }
      if (priority) {
        firestoreQuery = firestoreQuery.where('priority', '==', priority)
      }
      if (destination) {
        firestoreQuery = firestoreQuery.where('travelDetails.destination', '==', destination)
      }
      if (budget) {
        firestoreQuery = firestoreQuery.where('travelDetails.budget', '==', budget)
      }
      if (assignedToSalesRep) {
        firestoreQuery = firestoreQuery.where('assignedToSalesRep', '==', assignedToSalesRep)
      }
      if (createdAfter) {
        firestoreQuery = firestoreQuery.where('createdAt', '>=', Timestamp.fromDate(new Date(createdAfter)))
      }
      if (createdBefore) {
        firestoreQuery = firestoreQuery.where('createdAt', '<=', Timestamp.fromDate(new Date(createdBefore)))
      }

      firestoreQuery = firestoreQuery.orderBy(sortBy, sortOrder)

      const snapshot = await firestoreQuery.get()
      const leads = snapshot.docs.map((doc: any) => {
        const lead = this.convertFirestoreToLead(doc.data())
        return this.convertLeadToExportData(lead)
      })

      logger.info('Leads exported successfully', { count: leads.length })
      return leads
      
    } catch (error) {
      logger.error('Failed to export leads:', error)
      throw new Error('Failed to export leads')
    }
  }

  /**
   * Get lead statistics
   */
  static async getLeadStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    byPriority: Record<string, number>
    byBudget: Record<string, number>
    recentCount: number
  }> {
    try {
      const snapshot = await db.collection(LEADS_COLLECTION).get()
      const leads = snapshot.docs.map(doc => this.convertFirestoreToLead(doc.data()))

      const stats = {
        total: leads.length,
        byStatus: {} as Record<string, number>,
        byPriority: {} as Record<string, number>,
        byBudget: {} as Record<string, number>,
        recentCount: 0
      }

      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      leads.forEach(lead => {
        // Count by status
        stats.byStatus[lead.status] = (stats.byStatus[lead.status] || 0) + 1
        
        // Count by priority
        stats.byPriority[lead.priority] = (stats.byPriority[lead.priority] || 0) + 1
        
        // Count by budget
        stats.byBudget[lead.travelDetails.budget] = (stats.byBudget[lead.travelDetails.budget] || 0) + 1
        
        // Count recent leads (last 7 days)
        if (lead.createdAt > sevenDaysAgo) {
          stats.recentCount++
        }
      })

      return stats
      
    } catch (error) {
      logger.error('Failed to get lead stats:', error)
      throw new Error('Failed to retrieve lead statistics')
    }
  }

  /**
   * Convert Firestore document to Lead object
   */
  private static convertFirestoreToLead(data: any): Lead {
    return {
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
      lastContactedAt: data.lastContactedAt?.toDate(),
      nextFollowUpAt: data.nextFollowUpAt?.toDate()
    }
  }

  /**
   * Convert Lead to export data format
   */
  private static convertLeadToExportData(lead: Lead): LeadExportData {
    return {
      id: lead.id,
      email: lead.email,
      name: lead.name,
      phone: lead.phone,
      company: lead.company,
      destination: lead.travelDetails.destination,
      budget: lead.travelDetails.budget,
      groupSize: lead.travelDetails.groupSize,
      status: lead.status,
      priority: lead.priority,
      createdAt: lead.createdAt.toISOString(),
      lastContactedAt: lead.lastContactedAt?.toISOString(),
      nextFollowUpAt: lead.nextFollowUpAt?.toISOString(),
      assignedToSalesRep: lead.assignedToSalesRep,
      salesNotes: lead.salesNotes
    }
  }

  /**
   * Calculate lead priority based on travel details
   */
  private static calculatePriority(data: LeadCreateRequest): 'high' | 'medium' | 'low' {
    const { travelDetails } = data
    
    // High priority: luxury budget, large group, or long duration
    if (
      travelDetails.budget === 'luxury' ||
      travelDetails.groupSize >= 5 ||
      travelDetails.duration >= 10
    ) {
      return 'high'
    }
    
    // Medium priority: moderate budget, medium group, or medium duration
    if (
      travelDetails.budget === 'moderate' ||
      travelDetails.groupSize >= 2 ||
      travelDetails.duration >= 5
    ) {
      return 'medium'
    }
    
    return 'low'
  }
}