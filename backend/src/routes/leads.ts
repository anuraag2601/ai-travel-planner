import { Router } from 'express'
import { body, query, param, validationResult } from 'express-validator'
import { LeadService } from '@/services/leadService.js'
import { logger } from '@/utils/logger.js'
import { asyncHandler } from '@/middleware/asyncHandler.js'
import { LeadCreateRequest, LeadUpdateRequest, LeadListQuery } from '@/models/Lead.js'

const router = Router()

/**
 * Create a new lead
 * POST /api/v1/leads
 */
router.post('/',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
    body('phone').optional().trim().isMobilePhone().withMessage('Valid phone number required'),
    body('company').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Company must be 1-100 characters'),
    body('travelDetails.destination').notEmpty().trim().withMessage('Destination is required'),
    body('travelDetails.duration').isInt({ min: 1, max: 365 }).withMessage('Duration must be 1-365 days'),
    body('travelDetails.budget').isIn(['budget', 'moderate', 'luxury']).withMessage('Budget must be budget, moderate, or luxury'),
    body('travelDetails.groupSize').isInt({ min: 1, max: 50 }).withMessage('Group size must be 1-50 people'),
    body('travelDetails.originCity').optional().trim(),
    body('travelDetails.departureDate').optional().isISO8601().withMessage('Invalid departure date format'),
    body('travelDetails.returnDate').optional().isISO8601().withMessage('Invalid return date format'),
    body('travelDetails.interests').optional().trim(),
    body('travelDetails.travelStyle').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      })
    }

    try {
      // Check if lead already exists
      const existingLead = await LeadService.getLeadByEmail(req.body.email)
      if (existingLead) {
        return res.status(200).json({
          success: true,
          message: 'Lead already exists',
          lead: existingLead,
          isExisting: true
        })
      }

      // Extract client metadata
      const metadata = {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        referrer: req.get('Referer'),
        sessionId: req.sessionID,
        utmSource: req.query.utm_source as string,
        utmMedium: req.query.utm_medium as string,
        utmCampaign: req.query.utm_campaign as string
      }

      const leadData: LeadCreateRequest = {
        ...req.body,
        metadata
      }

      const lead = await LeadService.createLead(leadData)

      res.status(201).json({
        success: true,
        message: 'Lead created successfully',
        lead,
        isExisting: false
      })

    } catch (error: any) {
      logger.error('Failed to create lead:', error)
      res.status(500).json({
        success: false,
        error: {
          code: 'LEAD_CREATION_FAILED',
          message: error.message || 'Failed to create lead'
        }
      })
    }
  })
)

/**
 * Get all leads with filtering and pagination
 * GET /api/v1/leads
 */
router.get('/',
  [
    query('page').optional().isInt({ min: 1 }).toInt().withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt().withMessage('Limit must be 1-100'),
    query('status').optional().isIn(['new', 'contacted', 'qualified', 'converted', 'closed']),
    query('priority').optional().isIn(['high', 'medium', 'low']),
    query('budget').optional().isIn(['budget', 'moderate', 'luxury']),
    query('destination').optional().trim(),
    query('assignedToSalesRep').optional().trim(),
    query('createdAfter').optional().isISO8601().withMessage('Invalid createdAfter date format'),
    query('createdBefore').optional().isISO8601().withMessage('Invalid createdBefore date format'),
    query('sortBy').optional().isIn(['createdAt', 'updatedAt', 'priority', 'nextFollowUpAt']),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: errors.array()
        }
      })
    }

    try {
      const query: LeadListQuery = {
        page: req.query.page as any,
        limit: req.query.limit as any,
        status: req.query.status as string,
        priority: req.query.priority as string,
        destination: req.query.destination as string,
        budget: req.query.budget as string,
        assignedToSalesRep: req.query.assignedToSalesRep as string,
        createdAfter: req.query.createdAfter as string,
        createdBefore: req.query.createdBefore as string,
        sortBy: req.query.sortBy as any,
        sortOrder: req.query.sortOrder as any
      }

      const result = await LeadService.getLeads(query)

      res.json({
        success: true,
        data: result.leads,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          hasMore: result.hasMore,
          totalPages: Math.ceil(result.total / result.limit)
        }
      })

    } catch (error: any) {
      logger.error('Failed to get leads:', error)
      res.status(500).json({
        success: false,
        error: {
          code: 'LEADS_FETCH_FAILED',
          message: error.message || 'Failed to retrieve leads'
        }
      })
    }
  })
)

/**
 * Get lead by ID
 * GET /api/v1/leads/:id
 */
router.get('/:id',
  [
    param('id').notEmpty().withMessage('Lead ID is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid lead ID',
          details: errors.array()
        }
      })
    }

    try {
      const lead = await LeadService.getLeadById(req.params.id)

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'LEAD_NOT_FOUND',
            message: 'Lead not found'
          }
        })
      }

      res.json({
        success: true,
        data: lead
      })

    } catch (error: any) {
      logger.error('Failed to get lead:', error)
      res.status(500).json({
        success: false,
        error: {
          code: 'LEAD_FETCH_FAILED',
          message: error.message || 'Failed to retrieve lead'
        }
      })
    }
  })
)

/**
 * Update lead
 * PUT /api/v1/leads/:id
 */
router.put('/:id',
  [
    param('id').notEmpty().withMessage('Lead ID is required'),
    body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
    body('phone').optional().trim().isMobilePhone().withMessage('Valid phone number required'),
    body('company').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Company must be 1-100 characters'),
    body('status').optional().isIn(['new', 'contacted', 'qualified', 'converted', 'closed']),
    body('priority').optional().isIn(['high', 'medium', 'low']),
    body('salesNotes').optional().trim().isLength({ max: 1000 }).withMessage('Sales notes must be max 1000 characters'),
    body('lastContactedAt').optional().isISO8601().withMessage('Invalid lastContactedAt date format'),
    body('nextFollowUpAt').optional().isISO8601().withMessage('Invalid nextFollowUpAt date format'),
    body('assignedToSalesRep').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Sales rep name must be 1-100 characters')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      })
    }

    try {
      const updateData: LeadUpdateRequest = req.body

      // Convert date strings to Date objects
      if (updateData.lastContactedAt) {
        updateData.lastContactedAt = new Date(updateData.lastContactedAt)
      }
      if (updateData.nextFollowUpAt) {
        updateData.nextFollowUpAt = new Date(updateData.nextFollowUpAt)
      }

      const updatedLead = await LeadService.updateLead(req.params.id, updateData)

      res.json({
        success: true,
        message: 'Lead updated successfully',
        data: updatedLead
      })

    } catch (error: any) {
      if (error.message === 'Lead not found') {
        return res.status(404).json({
          success: false,
          error: {
            code: 'LEAD_NOT_FOUND',
            message: 'Lead not found'
          }
        })
      }

      logger.error('Failed to update lead:', error)
      res.status(500).json({
        success: false,
        error: {
          code: 'LEAD_UPDATE_FAILED',
          message: error.message || 'Failed to update lead'
        }
      })
    }
  })
)

/**
 * Export leads as CSV
 * GET /api/v1/leads/export/csv
 */
router.get('/export/csv',
  [
    query('status').optional().isIn(['new', 'contacted', 'qualified', 'converted', 'closed']),
    query('priority').optional().isIn(['high', 'medium', 'low']),
    query('budget').optional().isIn(['budget', 'moderate', 'luxury']),
    query('destination').optional().trim(),
    query('assignedToSalesRep').optional().trim(),
    query('createdAfter').optional().isISO8601().withMessage('Invalid createdAfter date format'),
    query('createdBefore').optional().isISO8601().withMessage('Invalid createdBefore date format'),
    query('sortBy').optional().isIn(['createdAt', 'updatedAt', 'priority', 'nextFollowUpAt']),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: errors.array()
        }
      })
    }

    try {
      const query: LeadListQuery = {
        status: req.query.status as string,
        priority: req.query.priority as string,
        destination: req.query.destination as string,
        budget: req.query.budget as string,
        assignedToSalesRep: req.query.assignedToSalesRep as string,
        createdAfter: req.query.createdAfter as string,
        createdBefore: req.query.createdBefore as string,
        sortBy: req.query.sortBy as any,
        sortOrder: req.query.sortOrder as any
      }

      const leads = await LeadService.getLeadsForExport(query)

      // Generate CSV content
      const csvHeaders = [
        'ID', 'Email', 'Name', 'Phone', 'Company', 'Destination', 'Budget', 
        'Group Size', 'Status', 'Priority', 'Created At', 'Last Contacted', 
        'Next Follow Up', 'Assigned Sales Rep', 'Sales Notes'
      ]

      const csvRows = leads.map(lead => [
        lead.id,
        lead.email,
        lead.name || '',
        lead.phone || '',
        lead.company || '',
        lead.destination,
        lead.budget,
        lead.groupSize.toString(),
        lead.status,
        lead.priority,
        lead.createdAt,
        lead.lastContactedAt || '',
        lead.nextFollowUpAt || '',
        lead.assignedToSalesRep || '',
        (lead.salesNotes || '').replace(/"/g, '""') // Escape quotes in CSV
      ])

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n')

      // Set CSV headers
      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `leads-export-${timestamp}.csv`
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')

      res.send(csvContent)

      logger.info('Leads exported successfully', { count: leads.length, filename })

    } catch (error: any) {
      logger.error('Failed to export leads:', error)
      res.status(500).json({
        success: false,
        error: {
          code: 'EXPORT_FAILED',
          message: error.message || 'Failed to export leads'
        }
      })
    }
  })
)

/**
 * Get lead statistics
 * GET /api/v1/leads/stats
 */
router.get('/stats/overview',
  asyncHandler(async (req, res) => {
    try {
      const stats = await LeadService.getLeadStats()

      res.json({
        success: true,
        data: stats
      })

    } catch (error: any) {
      logger.error('Failed to get lead stats:', error)
      res.status(500).json({
        success: false,
        error: {
          code: 'STATS_FETCH_FAILED',
          message: error.message || 'Failed to retrieve lead statistics'
        }
      })
    }
  })
)

export default router