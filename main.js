// Global variables
let map;
let currentCity = null;

// Default colors for buckets
const defaultColors = [
    'rgba(255, 59, 59, 0.4)',   // Red
    'rgba(255, 149, 5, 0.4)',   // Orange
    'rgba(255, 215, 0, 0.4)',   // Yellow
    'rgba(76, 187, 23, 0.4)',   // Green
    'rgba(0, 102, 204, 0.4)',   // Blue
    'rgba(102, 0, 153, 0.4)'    // Purple
];

// Default bucket ranges
const defaultBucketRanges = [
    { min: 1500, max: Infinity, label: '1500+', enabled: true },
    { min: 1250, max: 1500, label: '1250-1500', enabled: true },
    { min: 1000, max: 1250, label: '1000-1250', enabled: true },
    { min: 750, max: 1000, label: '750-1000', enabled: true },
    { min: 500, max: 750, label: '500-750', enabled: true },
    { min: 0, max: 500, label: '0-500', enabled: false }
];

// Initialize the map
function initializeMap() {
    console.log('Initializing map...');
    mapboxgl.accessToken = config.accessToken;
    
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/basic-v9',  // Using basic style
        center: [-98.5795, 39.8283],
        zoom: 4,
        preserveDrawingBuffer: true
    });

    // Wait for both style and map to be loaded
    map.on('style.load', () => {
        console.log('Style loaded');
    });

    map.on('load', () => {
        console.log('Map loaded, loading city data...');
        loadAllCityData();
        loadLocationData();
        initializeLocationFilters();
        setupFilterEventListeners();
        setupMapInteractions();
    });
}

// Load all city GeoJSON data
function loadAllCityData() {
    console.log('Fetching GeoJSON data...');
    fetch('data/all_cities.geojson')
        .then(response => {
            console.log('GeoJSON response received');
            return response.json();
        })
        .then(data => {
            console.log('GeoJSON data loaded:', data.features ? data.features.length : 'No features found');
            
            if (!map.getSource('all-cities')) {
                // Add the source for all cities
                map.addSource('all-cities', {
                    type: 'geojson',
                    data: data
                });

                // Add the fill layer for all cities
                map.addLayer({
                    'id': 'city-fills',
                    'type': 'fill',
                    'source': 'all-cities',
                    'paint': {
                        'fill-color': 'rgba(0, 0, 0, 0)',  // Fully transparent default
                        'fill-opacity': 1
                    }
                });

                console.log('Layer added');
                loadCityList();
                initializeFilterStates();
            }
        })
        .catch(error => {
            console.error('Error loading GeoJSON:', error);
        });
}

// Initialize filter states
function initializeFilterStates() {
    // Get parent checkboxes
    const parent250k = document.querySelector('#income250k-parent');
    const parent500k = document.querySelector('#income500k-parent');

    // Set 500k checked, 250k unchecked by default
    if (parent250k) parent250k.checked = false;
    if (parent500k) parent500k.checked = true;

    // Initialize category checkboxes
    document.querySelectorAll('.category-checkbox').forEach((checkbox) => {
        const parentGroup = checkbox.closest('.categories-container');
        const allCheckboxesInGroup = parentGroup.querySelectorAll('.category-checkbox');
        const isLastInGroup = checkbox === allCheckboxesInGroup[allCheckboxesInGroup.length - 1];
        
        // Set all checkboxes to checked except for the last ones in each group (0-500 buckets)
        checkbox.checked = !isLastInGroup;

        // Hide 250k group initially since parent is unchecked
        if (parentGroup.id === 'income250k-categories') {
            parentGroup.style.display = 'none';
        }
    });

    // Apply initial filters
    validateAndApplyFilters();
}

// Validate and apply filters
function validateAndApplyFilters() {
    // Get parent checkboxes
    const parent250k = document.querySelector('#income250k-parent');
    const parent500k = document.querySelector('#income500k-parent');

    // Build filters for both income levels
    const filters = {
        income250k: [],
        income500k: []
    };

    // Only collect 250k filters if parent is checked
    if (parent250k && parent250k.checked) {
        const categories = document.querySelectorAll('#income250k-categories .category-item');
        categories.forEach(category => {
            const checkbox = category.querySelector('.category-checkbox');
            if (checkbox && checkbox.checked) {
                const colorBox = category.querySelector('.color-box');
                const minInput = category.querySelector('.range-min');
                const maxInput = category.querySelector('.range-max');
                
                if (colorBox) {
                    filters.income250k.push({
                        min: parseInt(minInput?.value) || 0,
                        max: maxInput?.value ? parseInt(maxInput.value) : 999999,
                        color: colorBox.style.backgroundColor
                    });
                }
            }
        });
    }

    // Only collect 500k filters if parent is checked
    if (parent500k && parent500k.checked) {
        const categories = document.querySelectorAll('#income500k-categories .category-item');
        categories.forEach(category => {
            const checkbox = category.querySelector('.category-checkbox');
            if (checkbox && checkbox.checked) {
                const colorBox = category.querySelector('.color-box');
                const minInput = category.querySelector('.range-min');
                const maxInput = category.querySelector('.range-max');
                
                if (colorBox) {
                    filters.income500k.push({
                        min: parseInt(minInput?.value) || 0,
                        max: maxInput?.value ? parseInt(maxInput.value) : 999999,
                        color: colorBox.style.backgroundColor
                    });
                }
            }
        });
    }

    applyFiltersToMap(filters);
}

// Apply filters to map
function applyFiltersToMap(filters) {
    if (!map.getSource('all-cities')) {
        console.warn('No city data loaded');
        return;
    }

    // Build color expression
    const conditions = [];
    
    // Add 500k filters first (higher priority)
    filters.income500k.forEach(f => {
        conditions.push([
            'all',
            ['>=', ['to-number', ['get', 'kids_500k'], 0], f.min],
            ['<=', ['to-number', ['get', 'kids_500k'], 0], f.max]
        ]);
        conditions.push(f.color);
    });

    // Add 250k filters second (lower priority)
    filters.income250k.forEach(f => {
        conditions.push([
            'all',
            ['>=', ['to-number', ['get', 'kids_250k'], 0], f.min],
            ['<=', ['to-number', ['get', 'kids_250k'], 0], f.max]
        ]);
        conditions.push(f.color);
    });

    // Default color for the case statement (fully transparent)
    conditions.push('rgba(0, 0, 0, 0)');

    // Update the layer paint property with filter-based colors
    if (conditions.length > 1) {  // Only apply if we have actual conditions
        map.setPaintProperty('city-fills', 'fill-color', [
            'case',
            ...conditions
        ]);
    } else {
        // If no conditions, just set the default transparent color
        map.setPaintProperty('city-fills', 'fill-color', 'rgba(0, 0, 0, 0)');
    }

    // Ensure no borders by explicitly setting outline color to transparent
    map.setPaintProperty('city-fills', 'fill-outline-color', 'rgba(0, 0, 0, 0)');
}

// Setup filter event listeners
function setupFilterEventListeners() {
    // Parent checkbox listeners
    const parent250k = document.querySelector('#income250k-parent');
    const parent500k = document.querySelector('#income500k-parent');

    if (parent250k) {
        parent250k.addEventListener('change', () => {
            const group = document.querySelector('#income250k-categories');
            if (group) {
                group.style.display = parent250k.checked ? 'block' : 'none';
                
                // When parent is checked, restore previous child states (except 0-500)
                if (parent250k.checked) {
                    const checkboxes = group.querySelectorAll('.category-checkbox');
                    checkboxes.forEach((checkbox, index) => {
                        // Set all to checked except the last one (0-500)
                        checkbox.checked = (index < checkboxes.length - 1);
                    });
                }
            }
            validateAndApplyFilters();
        });
    }

    if (parent500k) {
        parent500k.addEventListener('change', () => {
            const group = document.querySelector('#income500k-categories');
            if (group) {
                group.style.display = parent500k.checked ? 'block' : 'none';
            }
            validateAndApplyFilters();
        });
    }

    // Category checkbox listeners
    document.querySelectorAll('.category-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', validateAndApplyFilters);
    });

    // Range input listeners
    document.querySelectorAll('.range-min, .range-max').forEach(input => {
        input.addEventListener('change', () => {
            updateFilterRanges();
            validateAndApplyFilters();
        });
    });
}

// Update filter ranges
function updateFilterRanges() {
    const ranges = {
        income250k: [],
        income500k: []
    };

    // Collect 250k ranges
    document.querySelectorAll('#income250k-categories .category-item').forEach(category => {
        const minInput = category.querySelector('.range-min');
        const maxInput = category.querySelector('.range-max');
        if (minInput && maxInput) {
            ranges.income250k.push({
                min: parseInt(minInput.value) || 0,
                max: maxInput.value ? parseInt(maxInput.value) : Infinity
            });
        }
    });

    // Collect 500k ranges
    document.querySelectorAll('#income500k-categories .category-item').forEach(category => {
        const minInput = category.querySelector('.range-min');
        const maxInput = category.querySelector('.range-max');
        if (minInput && maxInput) {
            ranges.income500k.push({
                min: parseInt(minInput.value) || 0,
                max: maxInput.value ? parseInt(maxInput.value) : Infinity
            });
        }
    });

    return ranges;
}

// Reset bucket values
function resetBucketValues() {
    const bucketRows = document.querySelectorAll('.bucket-row');
    
    bucketRows.forEach((row, index) => {
        const minInput = row.querySelector('.range-min');
        const maxInput = row.querySelector('.range-max');
        
        if (minInput && maxInput) {
            minInput.value = defaultBucketRanges[index].min;
            if (defaultBucketRanges[index].max === Infinity) {
                maxInput.value = '';
                maxInput.placeholder = 'No limit';
            } else {
                maxInput.value = defaultBucketRanges[index].max;
            }
        }
    });
    
    updateFilterRanges();
    validateAndApplyFilters();
}

// Setup map interactions
function setupMapInteractions() {
    // No interactions needed
}

// Load city list into dropdown
function loadCityList() {
    const citySelect = document.getElementById('city-select');
    if (!citySelect) return;

    // Clear existing options
    citySelect.innerHTML = '<option value="">Select a city...</option>';

    // Add options for each city
    config.polygonLayers.forEach(layer => {
        const option = document.createElement('option');
        option.value = layer.name;
        option.textContent = layer.name;
        citySelect.appendChild(option);
    });

    // Add change event listener
    citySelect.addEventListener('change', (e) => {
        const selectedCity = config.polygonLayers.find(layer => layer.name === e.target.value);
        if (selectedCity && selectedCity.coordinates) {
            map.flyTo({
                center: selectedCity.coordinates,
                zoom: selectedCity.zoom || 10,
                essential: true
            });
        }
    });
}

// Function to zoom to a specific city
function zoomToCity(cityName) {
    const source = map.getSource('all-cities');
    if (!source || !source._data) return;

    // Find all features for the selected city
    const cityFeatures = source._data.features.filter(f => f.properties.city === cityName);
    if (cityFeatures.length === 0) return;

    // Calculate the bounding box for all features in the city
    const bounds = new mapboxgl.LngLatBounds();
    cityFeatures.forEach(feature => {
        if (feature.geometry && feature.geometry.coordinates) {
            if (feature.geometry.type === 'Polygon') {
                feature.geometry.coordinates[0].forEach(coord => {
                    bounds.extend(coord);
                });
            } else if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(polygon => {
                    polygon[0].forEach(coord => {
                        bounds.extend(coord);
                    });
                });
            }
        }
    });

    // Zoom to the city bounds with padding
    map.fitBounds(bounds, {
        padding: 50,
        duration: 1000
    });
}

// Load city data and zoom to it
function loadCity(cityName) {
    if (!cityName) return;
    
    currentCity = cityName;
    zoomToCity(cityName);
    
    // Update URL parameters
    const url = new URL(window.location);
    url.searchParams.set('city', cityName);
    window.history.pushState({}, '', url);
}

// Load KML location data
async function loadLocationData() {
    // Clear existing markers
    if (window.locationMarkers) {
        window.locationMarkers.forEach(marker => marker.remove());
    }
    window.locationMarkers = [];

    for (const layer of config.locationLayers) {
        try {
            // Load and parse KML
            const response = await fetch(layer.file);
            const kmlText = await response.text();
            const kml = new DOMParser().parseFromString(kmlText, 'text/xml');
            const placemarks = kml.getElementsByTagName('Placemark');

            // Process each placemark
            Array.from(placemarks).forEach(placemark => {
                const pointElem = placemark.getElementsByTagName('Point')[0];
                if (!pointElem) return;
                
                const coordsElem = pointElem.getElementsByTagName('coordinates')[0];
                if (!coordsElem) return;
                
                const coords = coordsElem.textContent.trim().split(',');
                if (coords.length < 2) return;

                // Get name and description - try both 'name' and 'n' tags
                const nameElem = placemark.getElementsByTagName('name')[0] || placemark.getElementsByTagName('n')[0];
                const name = nameElem ? nameElem.textContent.trim() : '';

                // Get description
                const descElem = placemark.getElementsByTagName('description')[0];
                const description = descElem ? descElem.textContent.trim() : '';

                // Create marker element
                const el = document.createElement('div');
                el.className = `location-marker ${layer.id}`;
                el.style.backgroundColor = layer.color;
                el.style.width = '12px';
                el.style.height = '12px';
                el.style.borderRadius = '50%';
                el.style.cursor = 'pointer';
                el.style.border = '2px solid black'; // Add black border
                el.style.boxSizing = 'border-box'; // Ensure border doesn't increase size

                // Create marker
                const marker = new mapboxgl.Marker(el)
                    .setLngLat([parseFloat(coords[0]), parseFloat(coords[1])])
                    .addTo(map);

                // Add popup if name exists
                if (name || description) {
                    const popupContent = name + (description ? `\n${description}` : '');
                    const popup = new mapboxgl.Popup({
                        closeButton: false,
                        closeOnClick: false
                    }).setText(popupContent);

                    marker.setPopup(popup);

                    // Show popup on hover
                    el.addEventListener('mouseenter', () => popup.addTo(map));
                    el.addEventListener('mouseleave', () => popup.remove());
                }

                // Store marker reference
                window.locationMarkers.push(marker);
                marker.layerId = layer.id;
                marker.getElement().style.display = layer.defaultChecked ? 'block' : 'none';
            });

        } catch (error) {
            console.error(`Error loading location data for ${layer.id}:`, error);
        }
    }
}

// Initialize location filters
function initializeLocationFilters() {
    const filterContainer = document.getElementById('location-filters');
    
    config.locationLayers.forEach(layer => {
        const row = document.createElement('div');
        row.className = 'filter-row';
        
        // Create checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = layer.id;
        checkbox.checked = layer.defaultChecked;
        
        // Create label
        const label = document.createElement('label');
        label.htmlFor = layer.id;
        label.textContent = layer.name;
        
        // Add event listener
        checkbox.addEventListener('change', (e) => {
            const visibility = e.target.checked ? 'block' : 'none';
            // Update marker visibility
            window.locationMarkers
                .filter(marker => marker.layerId === layer.id)
                .forEach(marker => {
                    marker.getElement().style.display = visibility;
                });
        });
        
        // Assemble row
        row.appendChild(checkbox);
        row.appendChild(label);
        filterContainer.appendChild(row);
    });
}

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();
    
    // Setup city selection listener
    const citySelect = document.getElementById('city-select');
    if (citySelect) {
        citySelect.addEventListener('change', (e) => {
            loadCity(e.target.value);
        });
    }
});
