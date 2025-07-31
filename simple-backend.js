const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const { resolveAirportCode, getCitySuggestions } = require('./airport-city-mapping');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID || 'intuitionsearch-1719465776066',
  databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
});

const leadsCollection = firestore.collection('leads');

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// API credentials from environment
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;

// Health check endpoint
app.get('/api/v1/health', async (req, res) => {
  const health = {
    status: 'ok',
    message: 'AI Travel Planner API with Firestore',
    version: '1.0.1',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/v1/health',
      'POST /api/v1/search/airports',
      'GET /api/v1/cities/suggestions',
      'POST /api/v1/search/flights',
      'POST /api/v1/search/hotels',
      'POST /api/v1/itineraries/generate',
      'POST /api/v1/leads',
      'GET /api/v1/leads',
      'GET /api/v1/leads/export',
      'GET /api/v1/leads/stats'
    ],
    services: {
      anthropic: ANTHROPIC_API_KEY ? 'configured' : 'missing',
      amadeus: AMADEUS_API_KEY ? 'configured' : 'missing',
      firestore: 'connected'
    }
  };

  // Test Firestore connectivity
  try {
    const testDoc = await leadsCollection.doc('health-check').get();
    health.services.firestore = 'active';
  } catch (error) {
    health.services.firestore = 'error';
    health.firestore_error = error.message;
  }

  // Test Amadeus API connectivity if credentials are present
  if (AMADEUS_API_KEY && AMADEUS_API_SECRET) {
    try {
      await getAmadeusToken();
      health.services.amadeus = 'active';
    } catch (error) {
      health.services.amadeus = 'authentication_failed';
      health.amadeus_error = error.message;
    }
  }

  res.json(health);
});

// Airport code resolution endpoint
app.post('/api/v1/search/airports', async (req, res) => {
  try {
    const { cities } = req.body;
    
    if (!cities || !Array.isArray(cities)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of city names in the "cities" field'
      });
    }
    
    const results = cities.map(city => ({
      input: city,
      airportCode: resolveAirportCode(city),
      suggestions: getCitySuggestions(city, 3)
    }));
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Airport resolution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve airport codes'
    });
  }
});

// City suggestions endpoint
app.get('/api/v1/cities/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least 2 characters in the "q" query parameter'
      });
    }
    
    const suggestions = getCitySuggestions(q, 10);
    
    res.json({
      success: true,
      query: q,
      suggestions
    });
  } catch (error) {
    console.error('City suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get city suggestions'
    });
  }
});

// Generate Access Token for Amadeus (Test Environment)
const AMADEUS_BASE_URL = 'https://test.api.amadeus.com';

async function getAmadeusToken() {
  try {
    const response = await axios.post(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, 
      'grant_type=client_credentials&client_id=' + AMADEUS_API_KEY + '&client_secret=' + AMADEUS_API_SECRET,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Amadeus token error:', error.response?.data || error.message);
    throw new Error(`Amadeus authentication failed: ${error.response?.data?.error_description || error.message}`);
  }
}

// Enhanced flight search with fallbacks and recommendations
app.post('/api/v1/search/flights', async (req, res) => {
  try {
    const { origin, destination, departureDate, returnDate, adults = 1, currency = 'INR', max = 5 } = req.body;
    
    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        error: 'Missing required fields: origin, destination, departureDate'
      });
    }

    // Resolve airport codes from city names
    const originCode = resolveAirportCode(origin);
    const destinationCode = resolveAirportCode(destination);
    
    console.log(`Resolved airport codes: ${origin} -> ${originCode}, ${destination} -> ${destinationCode}`);

    const token = await getAmadeusToken();
    let flights = [];
    let searchStrategy = 'direct';
    let recommendations = [];
    
    // Strategy 1: Direct route search
    try {
      const searchParams = {
        originLocationCode: originCode,
        destinationLocationCode: destinationCode,
        departureDate: departureDate,
        adults: adults,
        max: max,
        currencyCode: currency
      };

      if (returnDate) {
        searchParams.returnDate = returnDate;
      }

      const response = await axios.get(`${AMADEUS_BASE_URL}/v2/shopping/flight-offers`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params: searchParams
      });

      if (response.data.data && response.data.data.length > 0) {
        flights = response.data.data.map(offer => ({
          id: offer.id,
          price: {
            total: parseFloat(offer.price.total),
            currency: offer.price.currency,
            formatted: `₹${Math.round(parseFloat(offer.price.total)).toLocaleString('en-IN')}`
          },
          duration: offer.itineraries[0].duration,
          segments: offer.itineraries[0].segments.map(segment => ({
            departure: {
              airport: segment.departure.iataCode,
              time: segment.departure.at
            },
            arrival: {
              airport: segment.arrival.iataCode,
              time: segment.arrival.at
            },
            carrier: segment.carrierCode,
            flightNumber: segment.number,
            duration: segment.duration
          })),
          bookingUrl: `https://www.amadeus.com/en/booking?origin=${originCode}&destination=${destinationCode}&departure=${departureDate}${returnDate ? '&return=' + returnDate : ''}&adults=${adults}`,
          type: flights.length === 0 ? (offer.itineraries[0].segments.length === 1 ? 'direct' : 'connecting') : 'alternative'
        }));
      }
    } catch (directError) {
      console.log('Direct flight search failed:', directError.message);
    }
    
    // Strategy 2: If no results, try alternative airports
    if (flights.length === 0) {
      searchStrategy = 'alternative';
      const alternativeAirports = {
        'BLR': ['MAA', 'COK'], // Bangalore alternatives: Chennai, Kochi
        'DEL': ['BOM'], // Delhi alternative: Mumbai
        'BOM': ['DEL'], // Mumbai alternative: Delhi
        'NYC': ['JFK', 'LGA', 'EWR'] // NYC alternatives
      };
      
      const originAlts = alternativeAirports[origin] || [];
      const destAlts = alternativeAirports[destination] || [];
      
      // Try origin alternatives
      for (const altOrigin of originAlts.slice(0, 2)) {
        try {
          const altSearchParams = {
            originLocationCode: altOrigin,
            destinationLocationCode: destination,
            departureDate: departureDate,
            adults: adults,
            max: 2,
            currencyCode: currency
          };
          
          if (returnDate) altSearchParams.returnDate = returnDate;
          
          const altResponse = await axios.get(`${AMADEUS_BASE_URL}/v2/shopping/flight-offers`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: altSearchParams
          });
          
          if (altResponse.data.data && altResponse.data.data.length > 0) {
            const altFlights = altResponse.data.data.slice(0, 1).map(offer => ({
              id: offer.id + '_alt',
              price: {
                total: parseFloat(offer.price.total),
                currency: offer.price.currency,
                formatted: `₹${Math.round(parseFloat(offer.price.total)).toLocaleString('en-IN')}`
              },
              duration: offer.itineraries[0].duration,
              segments: offer.itineraries[0].segments.map(segment => ({
                departure: {
                  airport: segment.departure.iataCode,
                  time: segment.departure.at
                },
                arrival: {
                  airport: segment.arrival.iataCode,
                  time: segment.arrival.at
                },
                carrier: segment.carrierCode,
                flightNumber: segment.number
              })),
              bookingUrl: `https://www.amadeus.com/en/booking?origin=${altOrigin}&destination=${destination}&departure=${departureDate}`,
              type: 'alternative',
              alternativeNote: `Depart from ${altOrigin} instead of ${origin}`
            }));
            flights.push(...altFlights);
            recommendations.push(`Consider departing from ${altOrigin} - similar distance from your location`);
            break;
          }
        } catch (error) {
          console.log(`Alternative airport search failed for ${altOrigin}:`, error.message);
        }
      }
    }
    
    // Generate smart recommendations
    if (flights.length > 0) {
      const prices = flights.map(f => f.price.total).sort((a, b) => a - b);
      const cheapest = prices[0];
      const mostExpensive = prices[prices.length - 1];
      
      if (mostExpensive > cheapest * 1.5) {
        recommendations.push(`Save ₹${Math.round(mostExpensive - cheapest).toLocaleString('en-IN')} by choosing the most economical option`);
      }
      
      const directFlights = flights.filter(f => f.segments.length === 1);
      const connectingFlights = flights.filter(f => f.segments.length > 1);
      
      if (directFlights.length > 0 && connectingFlights.length > 0) {
        const directPrice = Math.min(...directFlights.map(f => f.price.total));
        const connectingPrice = Math.min(...connectingFlights.map(f => f.price.total));
        if (directPrice > connectingPrice * 1.2) {
          recommendations.push(`Save ₹${Math.round(directPrice - connectingPrice).toLocaleString('en-IN')} with connecting flights`);
        }
      }
    }

    if (flights.length === 0) {
      return res.json({
        success: true,
        results: [],
        total: 0,
        message: 'No flights found for the selected route and dates',
        recommendations: [
          'Try searching for nearby dates (±2 days)',
          'Consider alternative airports if available',
          'Check if this is a popular travel route',
          'Some routes may require connecting flights through major hubs'
        ],
        searchStrategy: 'no_results'
      });
    }

    res.json({
      success: true,
      results: flights,
      total: flights.length,
      searchStrategy: searchStrategy,
      recommendations: recommendations,
      priceRange: {
        min: Math.min(...flights.map(f => f.price.total)),
        max: Math.max(...flights.map(f => f.price.total)),
        currency: 'INR'
      }
    });

  } catch (error) {
    console.error('Flight search error:', error.message);
    res.status(500).json({
      error: 'Flight search failed',
      message: 'Unable to search flights at this time',
      details: 'Please try again later or contact support if the issue persists',
      recommendations: [
        'Check your internet connection',
        'Verify the airport codes are correct',
        'Try searching for a different date'
      ]
    });
  }
});

// Enhanced hotel search with pricing and offers
app.post('/api/v1/search/hotels', async (req, res) => {
  try {
    const { cityCode, checkInDate, checkOutDate, adults = 1, currency = 'INR' } = req.body;
    
    if (!cityCode || !checkInDate || !checkOutDate) {
      return res.status(400).json({
        error: 'Missing required fields: cityCode, checkInDate, checkOutDate'
      });
    }

    // Resolve city code to airport code (hotels use same city codes as airports)
    const resolvedCityCode = resolveAirportCode(cityCode);
    console.log(`Resolved hotel city code: ${cityCode} -> ${resolvedCityCode}`);

    const token = await getAmadeusToken();
    let hotels = [];
    let recommendations = [];
    
    // Step 1: Get hotel list
    try {
      const hotelListResponse = await axios.get(`${AMADEUS_BASE_URL}/v1/reference-data/locations/hotels/by-city`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params: {
          cityCode: resolvedCityCode,
          radius: 15,
          radiusUnit: 'KM',
          amenities: 'WIFI,PARKING,RESTAURANT,POOL,SPA',
          ratings: '3,4,5'
        }
      });

      if (hotelListResponse.data.data && hotelListResponse.data.data.length > 0) {
        const hotelIds = hotelListResponse.data.data.slice(0, 8).map(hotel => hotel.hotelId);
        
        // Step 2: Get hotel offers with pricing
        try {
          const offersResponse = await axios.get(`${AMADEUS_BASE_URL}/v3/shopping/hotel-offers`, {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            params: {
              hotelIds: hotelIds.join(','),
              checkInDate: checkInDate,
              checkOutDate: checkOutDate,
              adults: adults,
              currency: currency,
              lang: 'EN'
            }
          });
          
          if (offersResponse.data.data) {
            hotels = offersResponse.data.data.slice(0, 5).map(hotelData => {
              const hotel = hotelData.hotel;
              const offers = hotelData.offers || [];
              const bestOffer = offers.length > 0 ? offers[0] : null;
              
              // Calculate nights
              const checkIn = new Date(checkInDate);
              const checkOut = new Date(checkOutDate);
              const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
              
              let priceInfo = null;
              if (bestOffer && bestOffer.price) {
                const totalPrice = parseFloat(bestOffer.price.total);
                const pricePerNight = totalPrice / nights;
                priceInfo = {
                  total: totalPrice,
                  perNight: pricePerNight,
                  currency: bestOffer.price.currency,
                  formatted: {
                    total: `₹${Math.round(totalPrice).toLocaleString('en-IN')}`,
                    perNight: `₹${Math.round(pricePerNight).toLocaleString('en-IN')}/night`
                  },
                  taxes: bestOffer.price.taxes || [],
                  nights: nights
                };
              }
              
              return {
                id: hotel.hotelId,
                name: hotel.name,
                rating: hotel.rating || 4,
                location: {
                  latitude: hotel.latitude,
                  longitude: hotel.longitude
                },
                address: hotel.address || { cityName: cityCode },
                amenities: hotel.amenities || ['WIFI', 'RESTAURANT'],
                price: priceInfo,
                description: hotel.description || {},
                contact: hotel.contact || {},
                bookingUrl: bestOffer ? 
                  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotel.name)}&checkin=${checkInDate}&checkout=${checkOutDate}&group_adults=${adults}` :
                  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(cityCode)}&checkin=${checkInDate}&checkout=${checkOutDate}&group_adults=${adults}`,
                hasLivePrice: !!priceInfo,
                availabilityStatus: bestOffer ? 'available' : 'check_availability'
              };
            });
          }
        } catch (offersError) {
          console.log('Hotel offers search failed, using basic hotel data:', offersError.message);
          
          // Fallback: Use basic hotel data without pricing
          hotels = hotelListResponse.data.data.slice(0, 5).map(hotel => ({
            id: hotel.hotelId,
            name: hotel.name,
            rating: hotel.rating || 4,
            location: {
              latitude: hotel.geoCode.latitude,
              longitude: hotel.geoCode.longitude
            },
            address: hotel.address,
            amenities: hotel.amenities || ['WIFI', 'RESTAURANT'],
            price: null,
            bookingUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotel.name)}&checkin=${checkInDate}&checkout=${checkOutDate}&group_adults=${adults}`,
            hasLivePrice: false,
            availabilityStatus: 'check_availability'
          }));
        }
      }
    } catch (hotelListError) {
      console.log('Hotel list search failed:', hotelListError.message);
    }
    
    // Generate smart recommendations
    if (hotels.length > 0) {
      const hotelsWithPrices = hotels.filter(h => h.price);
      
      if (hotelsWithPrices.length > 1) {
        const prices = hotelsWithPrices.map(h => h.price.perNight).sort((a, b) => a - b);
        const cheapest = prices[0];
        const mostExpensive = prices[prices.length - 1];
        
        if (mostExpensive > cheapest * 1.5) {
          recommendations.push(`Price range: ₹${Math.round(cheapest).toLocaleString('en-IN')} - ₹${Math.round(mostExpensive).toLocaleString('en-IN')} per night`);
        }
      }
      
      const highRatedHotels = hotels.filter(h => h.rating >= 4.5).length;
      if (highRatedHotels > 0) {
        recommendations.push(`${highRatedHotels} hotel${highRatedHotels > 1 ? 's' : ''} with 4.5+ star rating available`);
      }
      
      const amenityCounts = {};
      hotels.forEach(hotel => {
        hotel.amenities.forEach(amenity => {
          amenityCounts[amenity] = (amenityCounts[amenity] || 0) + 1;
        });
      });
      
      const commonAmenities = Object.entries(amenityCounts)
        .filter(([_, count]) => count >= hotels.length * 0.6)
        .map(([amenity, _]) => amenity);
        
      if (commonAmenities.length > 0) {
        recommendations.push(`Most hotels include: ${commonAmenities.slice(0, 3).join(', ')}`);
      }
    }

    if (hotels.length === 0) {
      return res.json({
        success: true,
        results: [],
        total: 0,
        message: 'No hotels found for the selected destination and dates',
        recommendations: [
          'Try searching for a nearby city',
          'Check if the dates are available',
          'Consider extending your search radius',
          'Popular destinations may have limited availability during peak seasons'
        ]
      });
    }

    const hotelsWithPrices = hotels.filter(h => h.price);
    const priceRange = hotelsWithPrices.length > 0 ? {
      min: Math.min(...hotelsWithPrices.map(h => h.price.perNight)),
      max: Math.max(...hotelsWithPrices.map(h => h.price.perNight)),
      currency: 'INR'
    } : null;

    res.json({
      success: true,
      results: hotels,
      total: hotels.length,
      recommendations: recommendations,
      priceRange: priceRange,
      searchInfo: {
        checkInDate,
        checkOutDate,
        nights: Math.ceil((new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24)),
        adults,
        cityCode
      }
    });

  } catch (error) {
    console.error('Hotel search error:', error.message);
    res.status(500).json({
      error: 'Hotel search failed',
      message: 'Unable to search hotels at this time',
      details: 'Please try again later or contact support if the issue persists',
      recommendations: [
        'Check your internet connection',
        'Verify the destination city is correct',
        'Try searching for a different date range'
      ]
    });
  }
});

// Lead capture endpoint (now using Firestore for permanent storage)

app.post('/api/v1/leads', async (req, res) => {
  try {
    const { 
      email, name, phone, company,
      travelDetails 
    } = req.body;
    
    if (!email || !travelDetails) {
      return res.status(400).json({
        success: false,
        error: 'Email and travel details are required'
      });
    }

    // Check if lead already exists in Firestore
    const existingLeadQuery = await leadsCollection
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();

    if (!existingLeadQuery.empty) {
      const existingLead = existingLeadQuery.docs[0].data();
      return res.json({
        success: true,
        message: 'Lead already exists',
        lead: { id: existingLeadQuery.docs[0].id, ...existingLead },
        isExisting: true
      });
    }

    // Create new lead
    const leadData = {
      email: email.toLowerCase(),
      name: name || '',
      phone: phone || '',
      company: company || '',
      travelDetails: travelDetails,
      leadSource: 'itinerary_generation',
      status: 'new',
      priority: calculateLeadPriority(travelDetails),
      metadata: {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        createdAt: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await leadsCollection.add(leadData);
    console.log(`🆕 New lead captured in Firestore: ${email} for ${travelDetails.destination} (ID: ${docRef.id})`);

    res.json({
      success: true,
      message: 'Lead captured successfully',
      lead: { id: docRef.id, ...leadData },
      isExisting: false
    });

  } catch (error) {
    console.error('Lead capture error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to capture lead',
      message: error.message
    });
  }
});

// Get leads endpoint for sales dashboard
app.get('/api/v1/leads', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      priority, 
      budget, 
      destination,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    let query = leadsCollection;
    
    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (priority) {
      query = query.where('priority', '==', priority);
    }
    if (budget) {
      query = query.where('travelDetails.budget', '==', budget);
    }
    if (destination) {
      query = query.where('travelDetails.destination', '==', destination);
    }
    
    // Apply sorting
    query = query.orderBy(sortBy, sortOrder);
    
    // Apply pagination
    const pageSize = Math.min(parseInt(limit), 100);
    const offset = (parseInt(page) - 1) * pageSize;
    
    if (offset > 0) {
      query = query.offset(offset);
    }
    query = query.limit(pageSize + 1); // Get one extra to check if there are more
    
    const snapshot = await query.get();
    const leads = [];
    const hasMore = snapshot.docs.length > pageSize;
    
    snapshot.docs.slice(0, pageSize).forEach(doc => {
      const data = doc.data();
      leads.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    // Get total count (simplified for this endpoint)
    const allSnapshot = await leadsCollection.get();
    const total = allSnapshot.size;

    res.json({
      success: true,
      data: leads,
      pagination: {
        page: parseInt(page),
        limit: pageSize,
        total: total,
        hasMore: hasMore,
        totalPages: Math.ceil(total / pageSize)
      }
    });

  } catch (error) {
    console.error('Get leads error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve leads',
      message: error.message
    });
  }
});

// Lead export endpoint for sales team
app.get('/api/v1/leads/export', async (req, res) => {
  try {
    const { format = 'json', status, priority } = req.query;
    
    let query = leadsCollection;
    
    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (priority) {
      query = query.where('priority', '==', priority);
    }
    
    const snapshot = await query.orderBy('createdAt', 'desc').get();
    const filteredLeads = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      filteredLeads.push({ 
        id: doc.id, 
        ...data,
        createdAt: data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
      });
    });

    if (format === 'csv') {
      // Generate CSV format
      const csvHeaders = ['ID', 'Email', 'Name', 'Phone', 'Company', 'Destination', 'Budget', 'Status', 'Priority', 'Created At'];
      const csvRows = filteredLeads.map(lead => [
        lead.id,
        lead.email,
        lead.name,
        lead.phone,
        lead.company,
        lead.travelDetails.destination,
        lead.travelDetails.budget,
        lead.status,
        lead.priority,
        lead.createdAt
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="leads-export.csv"');
      res.send(csvContent);
    } else {
      // JSON format
      res.json({
        success: true,
        count: filteredLeads.length,
        leads: filteredLeads,
        exported_at: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Lead export error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to export leads'
    });
  }
});

// Lead statistics endpoint
app.get('/api/v1/leads/stats', async (req, res) => {
  try {
    const snapshot = await leadsCollection.get();
    const leads = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      leads.push({
        ...data,
        createdAt: data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt)
      });
    });
    
    const stats = {
      total: leads.length,
      byStatus: {},
      byPriority: {},
      byDestination: {},
      recent: leads.filter(lead => {
        const leadDate = lead.createdAt;
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return leadDate > weekAgo;
      }).length
    };

    // Calculate statistics
    leads.forEach(lead => {
      stats.byStatus[lead.status] = (stats.byStatus[lead.status] || 0) + 1;
      stats.byPriority[lead.priority] = (stats.byPriority[lead.priority] || 0) + 1;
      stats.byDestination[lead.travelDetails.destination] = (stats.byDestination[lead.travelDetails.destination] || 0) + 1;
    });

    res.json({
      success: true,
      stats: stats,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Lead stats error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate lead statistics'
    });
  }
});

// Helper function to calculate lead priority
function calculateLeadPriority(travelDetails) {
  const { budget, groupSize, duration } = travelDetails;
  
  if (budget === 'luxury' || groupSize >= 5 || duration >= 10) {
    return 'high';
  }
  if (budget === 'moderate' || groupSize >= 2 || duration >= 5) {
    return 'medium';
  }
  return 'low';
}

// AI Itinerary generation endpoint
app.post('/api/v1/itineraries/generate', async (req, res) => {
  try {
    const { 
      originCity, destination, duration, budget, interests, travelStyle, groupSize = 1,
      departureDate, returnDate, flightData, hotelData 
    } = req.body;
    
    if (!destination || !duration) {
      return res.status(400).json({
        error: 'Missing required fields: destination, duration'
      });
    }

    // Build flight information for AI context
    let flightInfo = '';
    if (flightData && flightData.success && flightData.results.length > 0) {
      const bestFlight = flightData.results[0];
      flightInfo = `\n\nLIVE FLIGHT DATA AVAILABLE:
- Best flight option: ${bestFlight.price.total} ${bestFlight.price.currency}
- Flight duration: ${bestFlight.duration}
- Departure: ${bestFlight.segments[0].departure.airport} at ${bestFlight.segments[0].departure.time}
- Arrival: ${bestFlight.segments[0].arrival.airport} at ${bestFlight.segments[0].arrival.time}
- Airline: ${bestFlight.segments[0].carrier} ${bestFlight.segments[0].flightNumber}
Please reference this flight information in your recommendations.`;
    }

    // Build hotel information for AI context
    let hotelInfo = '';
    if (hotelData && hotelData.success && hotelData.results.length > 0) {
      const bestHotel = hotelData.results[0];
      hotelInfo = `\n\nLIVE HOTEL DATA AVAILABLE:
- Recommended hotel: ${bestHotel.name}
- Rating: ${bestHotel.rating} stars
- Location: ${bestHotel.address ? Object.values(bestHotel.address).join(', ') : 'City center'}
- Amenities: ${bestHotel.amenities ? bestHotel.amenities.join(', ') : 'Standard amenities'}
Please reference this hotel information in your recommendations.`;
    }

    // Note if live data was requested but unavailable
    let dataAvailabilityNote = '';
    if (!flightInfo && !hotelInfo) {
      dataAvailabilityNote = '\n\nNOTE: Live flight and hotel data was requested but is currently unavailable due to API limitations. This itinerary provides general recommendations for flights and accommodations.';
    }

    const prompt = `Create a detailed ${duration}-day travel itinerary for ${destination}${originCity ? ` (traveling from ${originCity})` : ''}.
    
Trip Details:
- Origin: ${originCity || 'Not specified'}
- Destination: ${destination}
- Duration: ${duration} days
- Travel Dates: ${departureDate || 'Not specified'}${returnDate ? ` to ${returnDate}` : ''}
- Budget: ${budget || 'moderate'}
- Interests: ${interests || 'general sightseeing'}
- Travel Style: ${travelStyle || 'balanced'}
- Group Size: ${groupSize} people${flightInfo}${hotelInfo}${dataAvailabilityNote}

Please provide:
1. Daily schedule with specific activities and timings
2. Recommended restaurants and local cuisine
3. Transportation suggestions (including airport transfers${flightInfo ? ' based on the provided flight data' : ''})
4. Budget breakdown if budget is specified
5. Cultural insights and local tips
6. Must-see attractions and hidden gems
7. ${flightInfo || hotelInfo ? 'Integrate the provided live flight/hotel data naturally into recommendations' : 'Provide general flight and hotel recommendations with estimated costs'}

Format the response as a structured itinerary with clear day-by-day breakdown.${flightInfo || hotelInfo ? ' Reference the specific flight/hotel information provided above.' : ' Include estimated flight costs and hotel recommendations for the specified budget range.'}`;

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      }
    });

    const itinerary = {
      id: 'itin_' + Date.now(),
      destination: destination,
      duration: duration,
      budget: budget,
      generated_at: new Date().toISOString(),
      content: response.data.content[0].text,
      summary: {
        total_days: duration,
        estimated_budget: budget,
        group_size: groupSize,
        travel_style: travelStyle
      }
    };

    res.json({
      success: true,
      itinerary: itinerary
    });

  } catch (error) {
    console.error('Itinerary generation error:', error.message);
    res.status(500).json({
      error: 'Itinerary generation failed',
      message: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Sales dashboard endpoint
app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Sales Dashboard - Travel Leads</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            min-height: 100vh;
            color: #ecf0f1;
        }
        .dashboard-container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .header {
            text-align: center; margin-bottom: 40px;
            background: rgba(255, 255, 255, 0.1);
            padding: 30px; border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px; margin-bottom: 40px;
        }
        .stat-card {
            background: rgba(255, 255, 255, 0.1);
            padding: 25px; border-radius: 15px;
            text-align: center; backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .stat-number { font-size: 2.5em; font-weight: bold; margin-bottom: 10px; }
        .controls-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px; margin-bottom: 30px;
        }
        .control-group label { display: block; margin-bottom: 5px; font-weight: bold; }
        .control-group select, .control-group input {
            width: 100%; padding: 10px; border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            background: rgba(255, 255, 255, 0.1);
            color: white;
        }
        .btn {
            padding: 12px 24px; border: none; border-radius: 25px;
            cursor: pointer; font-weight: bold;
            transition: all 0.3s ease; text-decoration: none;
            display: inline-block;
        }
        .btn-primary { background: linear-gradient(45deg, #3498db, #2980b9); color: white; }
        .btn-export { background: linear-gradient(45deg, #e67e22, #d35400); color: white; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2); }
        .leads-table {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px; overflow: hidden;
            color: #2c3e50; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        .table-header {
            background: #34495e; color: white; padding: 20px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .table-content { max-height: 600px; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #ecf0f1; }
        th { background: #f8f9fa; font-weight: 600; position: sticky; top: 0; z-index: 10; }
        tr:hover { background: #f8f9fa; }
        .loading { text-align: center; padding: 40px; }
        .error { background: #e74c3c; color: white; padding: 15px; border-radius: 10px; margin: 20px 0; display: none; }
        .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .status-new { background: #3498db; color: white; }
        .priority-high { background: #fee; border-left: 4px solid #e74c3c; }
        .priority-medium { background: #fffbf0; border-left: 4px solid #f39c12; }
        .priority-low { background: #f0fff4; border-left: 4px solid #27ae60; }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <div class="header">
            <h1>📊 Sales Dashboard</h1>
            <p>Travel Leads Management Portal</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number" id="totalLeads">-</div>
                <div>Total Leads</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="newLeads">-</div>
                <div>New Leads</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="highPriorityLeads">-</div>
                <div>High Priority</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="recentLeads">-</div>
                <div>This Week</div>
            </div>
        </div>
        
        <div class="controls-row">
            <div class="control-group">
                <label>Status Filter:</label>
                <select id="filterStatus">
                    <option value="">All Statuses</option>
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="qualified">Qualified</option>
                    <option value="converted">Converted</option>
                </select>
            </div>
            <div class="control-group">
                <label>Priority Filter:</label>
                <select id="filterPriority">
                    <option value="">All Priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
            </div>
            <div class="control-group">
                <label>Export Data:</label>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-export" onclick="exportLeads('json')">Export JSON</button>
                    <button class="btn btn-export" onclick="exportLeads('csv')">Export CSV</button>
                </div>
            </div>
        </div>
        
        <div class="error" id="error"></div>
        
        <div class="leads-table">
            <div class="table-header">
                <h3>🎯 Lead Management</h3>
                <button class="btn btn-primary" onclick="loadLeads()">Refresh Data</button>
            </div>
            <div class="table-content">
                <div id="loadingSpinner" class="loading">
                    <div style="border: 4px solid rgba(52, 73, 94, 0.3); border-top: 4px solid #34495e; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto;"></div>
                    <p>Loading leads...</p>
                </div>
                <table id="leadsTable" style="display: none;">
                    <thead>
                        <tr>
                            <th>📧 Email</th>
                            <th>👤 Name</th>
                            <th>🏢 Company</th>
                            <th>🌍 Destination</th>
                            <th>💰 Budget</th>
                            <th>📊 Status</th>
                            <th>⚡ Priority</th>
                            <th>📅 Created</th>
                        </tr>
                    </thead>
                    <tbody id="leadsTableBody">
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        const API_BASE_URL = 'https://ai-travel-backend-rdq67befza-uc.a.run.app/api/v1';
        let currentLeads = [];

        async function loadLeads() {
            try {
                showLoading();
                hideError();
                
                const params = new URLSearchParams();
                const status = document.getElementById('filterStatus').value;
                const priority = document.getElementById('filterPriority').value;
                
                if (status) params.append('status', status);
                if (priority) params.append('priority', priority);
                
                const response = await fetch(API_BASE_URL + '/leads/export?' + params.toString());
                
                if (!response.ok) {
                    throw new Error('Failed to load leads');
                }
                
                const result = await response.json();
                if (result.success) {
                    currentLeads = result.leads;
                    displayLeads(currentLeads);
                } else {
                    throw new Error(result.error || 'Unknown error');
                }
            } catch (error) {
                console.error('Error loading leads:', error);
                showError('Failed to load leads: ' + error.message);
            } finally {
                hideLoading();
            }
        }

        async function loadStats() {
            try {
                const response = await fetch(API_BASE_URL + '/leads/stats');
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        updateStats(result.stats);
                    }
                }
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }

        function displayLeads(leads) {
            const tbody = document.getElementById('leadsTableBody');
            tbody.innerHTML = '';
            
            if (leads.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #7f8c8d;">No leads found</td></tr>';
                return;
            }
            
            leads.forEach(lead => {
                const row = tbody.insertRow();
                row.className = 'priority-' + lead.priority;
                
                row.innerHTML = \`
                    <td>\${lead.email}</td>
                    <td>\${lead.name || '-'}</td>
                    <td>\${lead.company || '-'}</td>
                    <td>\${lead.travelDetails.destination}</td>
                    <td>\${lead.travelDetails.budget}</td>
                    <td><span class="status-badge status-\${lead.status}">\${lead.status}</span></td>
                    <td>\${lead.priority}</td>
                    <td>\${formatDate(lead.createdAt)}</td>
                \`;
            });
        }

        function updateStats(stats) {
            document.getElementById('totalLeads').textContent = stats.total;
            document.getElementById('newLeads').textContent = stats.byStatus?.new || 0;
            document.getElementById('highPriorityLeads').textContent = stats.byPriority?.high || 0;
            document.getElementById('recentLeads').textContent = stats.recent;
        }

        function showLoading() {
            document.getElementById('loadingSpinner').style.display = 'block';
            document.getElementById('leadsTable').style.display = 'none';
        }

        function hideLoading() {
            document.getElementById('loadingSpinner').style.display = 'none';
            document.getElementById('leadsTable').style.display = 'table';
        }

        function showError(message) {
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function hideError() {
            document.getElementById('error').style.display = 'none';
        }

        function formatDate(dateString) {
            return new Date(dateString).toLocaleDateString();
        }

        async function exportLeads(format) {
            try {
                const params = new URLSearchParams();
                const status = document.getElementById('filterStatus').value;
                const priority = document.getElementById('filterPriority').value;
                
                if (status) params.append('status', status);
                if (priority) params.append('priority', priority);
                
                let url;
                if (format === 'csv') {
                    url = API_BASE_URL + '/leads/export?format=csv&' + params.toString();
                } else {
                    url = API_BASE_URL + '/leads/export?format=json&' + params.toString();
                }
                
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error('Export failed');
                }
                
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = 'leads-export.' + format;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(downloadUrl);
                
            } catch (error) {
                console.error('Export error:', error);
                showError('Failed to export leads: ' + error.message);
            }
        }

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            loadLeads();
            loadStats();
            
            document.getElementById('filterStatus').addEventListener('change', loadLeads);
            document.getElementById('filterPriority').addEventListener('change', loadLeads);
        });
    </script>
</body>
</html>
  `);
});

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Travel Planner API running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`🤖 Anthropic API: ${ANTHROPIC_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`✈️  Amadeus API: ${AMADEUS_API_KEY ? 'Configured' : 'Missing'}`);
});