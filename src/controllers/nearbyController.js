const { PartnerInfrastructure, User, Workshop } = require('../models/authModels');
const FacilityBooking = require('../models/facilityBookingModel');

/**
 * Get nearby partners (schools/infrastructures)
 * GET /api/nearby/partners?lat=...&lng=...&radius=...
 */
exports.getNearbyPartners = async (req, res) => {
    try {
        const { lat, lng, radius = 10 } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                status: false,
                message: 'Latitude and longitude are required'
            });
        }

        const partners = await PartnerInfrastructure.find({
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(lng), parseFloat(lat)]
                    },
                    $maxDistance: parseFloat(radius) * 1000 // radius in meters
                }
            }
        }).populate('partnerId', 'name email phone profileImage');

        res.status(200).json({
            status: true,
            results: partners.length,
            data: partners
        });
    } catch (error) {
        console.error('Error in getNearbyPartners:', error);
        res.status(500).json({
            status: false,
            message: 'Server error while fetching nearby partners',
            error: error.message
        });
    }
};

/**
 * Get nearby workshops
 * GET /api/nearby/workshops?lat=...&lng=...&radius=...
 */
exports.getNearbyWorkshops = async (req, res) => {
    try {
        const { lat, lng, radius = 10 } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                status: false,
                message: 'Latitude and longitude are required'
            });
        }

        const workshops = await Workshop.find({
            status: 'published',
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(lng), parseFloat(lat)]
                    },
                    $maxDistance: parseFloat(radius) * 1000
                }
            }
        }).populate('createdBy', 'name email profileImage');

        res.status(200).json({
            status: true,
            results: workshops.length,
            data: workshops
        });
    } catch (error) {
        console.error('Error in getNearbyWorkshops:', error);
        res.status(500).json({
            status: false,
            message: 'Server error while fetching nearby workshops',
            error: error.message
        });
    }
};

/**
 * Get nearby instructors (Teachers)
 * GET /api/nearby/instructors?lat=...&lng=...&radius=...
 */
exports.getNearbyInstructors = async (req, res) => {
    try {
        const { lat, lng, radius = 10 } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                status: false,
                message: 'Latitude and longitude are required'
            });
        }

        const instructors = await User.find({
            role: { $in: ['teacher', 'Teacher', 'Instructor'] },
            status: 'Active',
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(lng), parseFloat(lat)]
                    },
                    $maxDistance: parseFloat(radius) * 1000
                }
            }
        }).select('name email phone profileImage teacherProfile address');

        res.status(200).json({
            status: true,
            results: instructors.length,
            data: instructors
        });
    } catch (error) {
        console.error('Error in getNearbyInstructors:', error);
        res.status(500).json({
            status: false,
            message: 'Server error while fetching nearby instructors',
            error: error.message
        });
    }
};

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI/180);
    const dLon = (lon2 - lon1) * (Math.PI/180); 
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c; // Distance in km
}

/**
 * Get nearby facilities with availability check
 * GET /api/nearby/facilities?lat=...&lng=...&radius=...&type=...&minCapacity=...&date=...&startTime=...&endTime=...
 */
exports.getNearbyFacilities = async (req, res) => {
    try {
        const { lat, lng, radius = 50, type, minCapacity, date, startTime, endTime } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ status: false, message: 'Latitude and longitude are required' });
        }

        // 1. Geo Filter: Fetch nearby partners using the correct location path
        const partners = await PartnerInfrastructure.find({
            'generalInfo.location': {
                $near: {
                    $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    $maxDistance: parseFloat(radius) * 1000 // radius in meters
                }
            }
        });

        if (!partners || partners.length === 0) {
            return res.status(200).json({ status: true, results: 0, data: [] });
        }

        // 2. Prepare capacity filter
        const capacity = minCapacity ? parseInt(minCapacity, 10) : 0;
        const requestedType = type && type !== 'All' ? type : null;

        // 3. Fetch bookings for the requested date and time to filter availability
        let bookedFacilityIds = new Set();
        if (date && startTime && endTime) {
            const bookings = await FacilityBooking.find({
                date,
                status: { $ne: 'Cancelled' },
                $expr: {
                    $and: [
                        { $lt: ["$startTime", endTime] },
                        { $gt: ["$endTime", startTime] }
                    ]
                }
            });
            bookings.forEach(b => bookedFacilityIds.add(b.facilityId.toString()));
        }

        // 4. Filter and structure facilities
        const results = [];

        partners.forEach(partner => {
            const facilities = [];

            // Process classrooms
            if (!requestedType || requestedType === 'Classroom') {
                partner.classrooms?.forEach(c => {
                    const cId = c._id?.toString() || c.id;
                    if (c.capacity >= capacity && !bookedFacilityIds.has(cId)) {
                        facilities.push({
                            facilityId: cId,
                            facilityName: c.name,
                            facilityType: 'Classroom',
                            capacity: c.capacity,
                            features: c.technology || [],
                            status: 'Available',
                            pricing: {
                                amount: c.availabilitySchedule?.[0]?.pricing?.amount || 0,
                                unit: c.availabilitySchedule?.[0]?.pricing?.unit || 'Hourly'
                            },
                            availabilitySchedule: c.availabilitySchedule || []
                        });
                    }
                });
            }

            // Process computer labs
            if (!requestedType || requestedType === 'Lab') {
                partner.computerLabs?.forEach(c => {
                    const cId = c._id?.toString() || c.id;
                    const cCapacity = c.capacity || c.workstations || 0;
                    if (cCapacity >= capacity && !bookedFacilityIds.has(cId)) {
                        facilities.push({
                            facilityId: cId,
                            facilityName: c.name,
                            facilityType: 'Lab',
                            capacity: cCapacity,
                            features: [...(c.softwareAvailable || []), c.internetSpeed].filter(x => !!x),
                            status: 'Available',
                            pricing: {
                                amount: c.availabilitySchedule?.[0]?.pricing?.amount || 0,
                                unit: c.availabilitySchedule?.[0]?.pricing?.unit || 'Hourly'
                            },
                            availabilitySchedule: c.availabilitySchedule || []
                        });
                    }
                });
            }

            // Process other facilities
            if (!requestedType || requestedType === 'Other') {
                partner.otherFacilities?.forEach(c => {
                    const cId = c._id?.toString() || c.id;
                    const cCapacity = c.capacity || 0;
                    if (cCapacity >= capacity && !bookedFacilityIds.has(cId)) {
                        facilities.push({
                            facilityId: cId,
                            facilityName: c.name,
                            facilityType: 'Other',
                            capacity: cCapacity,
                            features: [
                                ...(c.soundSystem ? ['Sound System'] : []),
                                ...(c.lightingSystem ? ['Lighting System'] : []),
                                ...(c.projectorScreen ? ['Projector Screen'] : [])
                            ],
                            status: 'Available',
                            pricing: {
                                amount: c.availabilitySchedule?.[0]?.pricing?.amount || 0,
                                unit: c.availabilitySchedule?.[0]?.pricing?.unit || 'Hourly'
                            },
                            availabilitySchedule: c.availabilitySchedule || []
                        });
                    }
                });
            }

            // If partner has matching available facilities, calculate distance and add to results
            if (facilities.length > 0) {
                // Approximate distance using Haversine formula
                const distanceKm = calculateDistance(
                    lat, lng, 
                    partner.generalInfo.location.coordinates[1], 
                    partner.generalInfo.location.coordinates[0]
                );
                
                if (capacity > 0) {
                    const bestMatch = [...facilities].sort((a,b) => (a.capacity - capacity) - (b.capacity - capacity))[0];
                    if (bestMatch) {
                        facilities.forEach(f => f.isRecommended = (f.facilityId === bestMatch.facilityId));
                    }
                }

                const address = partner.generalInfo?.address;
                let formattedAddress = 'Address not available';
                if (address) {
                    const parts = [address.addressLine1, address.city, address.state, address.pincode].filter(Boolean);
                    formattedAddress = parts.join(', ');
                }

                results.push({
                    partnerId: partner.partnerId || partner._id,
                    partnerName: partner.generalInfo?.schoolName || partner.title || 'Unknown Partner',
                    address: formattedAddress,
                    shortAddress: address?.city || 'Local Area',
                    distance: parseFloat(distanceKm.toFixed(1)),
                    coordinates: {
                        lat: partner.generalInfo.location.coordinates[1],
                        lng: partner.generalInfo.location.coordinates[0]
                    },
                    totalFacilities: facilities.length,
                    availableFacilities: facilities.length,
                    facilities: facilities.sort((a,b) => a.capacity - b.capacity)
                });
            }
        });

        results.sort((a, b) => a.distance - b.distance);

        res.status(200).json({
            status: true,
            results: results.length,
            data: results
        });
    } catch (error) {
        console.error('Error in getNearbyFacilities:', error);
        res.status(500).json({
            status: false,
            message: 'Server error while fetching nearby facilities',
            error: error.message
        });
    }
};
