// Global variables
let map;
let currentCity = null;
let loadedTiles = new Set();
let visibleTiles = new Set(); // Track currently visible tiles
let loadingTiles = new Set(); // Track tiles currently being loaded
let tileLoadStartTimes = new Map(); // Track when each tile started loading
let metadata = null;
let currentlyLoadingTiles = new Set();
let moveEndTimeout = null;
const TILE_LOAD_TIMEOUT = 5000; // 5 seconds timeout for tile loading
const ZOOM_THRESHOLD = 4; // Zoom level threshold for loading/unloading tiles
const LOAD_BATCH_SIZE = 10; // Number of tiles to load in parallel
let loadedNeighborhoods = new Set();

// Base URL for tile data - change this based on environment
const BASE_URL = window.location.href.includes('github.io') 
    ? '/dynamic-microschool-heatmaps'  // GitHub Pages URL
    : '.';  // Local development URL

// Helper function to calculate distance from viewport center
function getDistanceFromCenter(gridRef, viewportCenter) {
    const gridBounds = metadata[gridRef].bounds;
    const gridCenterLat = (gridBounds.min_lat + gridBounds.max_lat) / 2;
    const gridCenterLon = (gridBounds.min_lon + gridBounds.max_lon) / 2;
    const dlat = gridCenterLat - viewportCenter.lat;
    const dlon = gridCenterLon - viewportCenter.lng;
    return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Helper function to find the first non-background layer
function getFirstNonBackgroundLayer(map) {
    const layers = map.getStyle().layers;
    // Skip background, fill, and other base map layers
    const skipTypes = ['background', 'fill', 'line', 'symbol', 'raster', 'circle', 'fill-extrusion', 'heatmap', 'hillshade'];
    for (const layer of layers) {
        if (!skipTypes.includes(layer.type) || layer.id.startsWith('neighborhood-layer') || layer.id.startsWith('pin-layer') || layer.id.startsWith('kml-layer')) {
            return layer.id;
        }
    }
    return undefined;
}

// Helper function to find the first road layer
function findFirstRoadLayer(map) {
    const layers = map.getStyle().layers;
    for (const layer of layers) {
        if (layer.id.includes('road') || layer.id.includes('street')) {
            return layer.id;
        }
    }
    return undefined;
}

// Load a batch of tiles in parallel
async function loadTileBatch(tiles) {
    console.log('Loading batch of tiles:', tiles);
    return Promise.all(tiles.map(gridRef => loadTile(gridRef)));
}

// Load metadata and initialize tile loading
async function loadMetadata() {
    try {
        console.log('Loading metadata from:', `${BASE_URL}/data/tiles/metadata.json`);
        const response = await fetch(`${BASE_URL}/data/tiles/metadata.json`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Loaded metadata:', data);
        return data.grids; // Extract the grids object from the metadata
    } catch (error) {
        console.error('Error loading metadata:', error);
        return null;
    }
}

// Get active income group based on checkbox states
function getActiveIncomeGroup() {
    return '250k'; // Always use 250k since we removed other options
}

// Update layer colors based on filters and active income group
function updateLayerColors(map, sourceId, layerId) {
    if (!map.getSource(sourceId) || !map.getLayer(layerId)) {
        console.log(`Source ${sourceId} or layer ${layerId} not found`);
        return;
    }

    const features = map.getSource(sourceId)._data.features;
    if (!features || features.length === 0) {
        console.log(`No features found for source ${sourceId}`);
        return;
    }

    const field = 'kids_250k'; // Always use 250k field
    console.log(`Updating colors for ${features.length} features in layer ${layerId} using field ${field}`);
    
    map.setPaintProperty(layerId, 'fill-color', [
        'step',
        ['get', field],
        'rgba(255, 255, 255, 0)',  // Default color for 0
        500, 'rgba(0, 0, 255, 0.7)',  // 500-750 kids
        750, 'rgba(0, 255, 0, 0.7)',  // 750-1000 kids
        1000, 'rgba(255, 255, 0, 0.7)',  // 1000-1250 kids
        1250, 'rgba(255, 128, 0, 0.7)',  // 1250-1500 kids
        1500, 'rgba(255, 0, 0, 0.7)'  // 1500+ kids
    ]);
}

// Load a specific tile
async function loadTile(gridRef) {
    if (loadedTiles.has(gridRef) || currentlyLoadingTiles.has(gridRef)) {
        console.log(`Skipping tile ${gridRef} - already loaded or loading`);
        return;
    }

    const sourceId = `tile-source-${gridRef}`;
    const layerId = `tile-layer-${gridRef}`;

    try {
        currentlyLoadingTiles.add(gridRef);
        console.log(`Starting to load tile ${gridRef}`);

        if (map.getSource(sourceId)) {
            console.log(`Removing existing source for ${gridRef}`);
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            map.removeSource(sourceId);
        }

        console.log(`Fetching tile data from: ${BASE_URL}/data/tiles/${gridRef}.geojson`);
        const response = await fetch(`${BASE_URL}/data/tiles/${gridRef}.geojson`);
        if (!response.ok) {
            throw new Error(`Failed to load tile ${gridRef}`);
        }
        const data = await response.json();
        console.log(`Successfully loaded data for ${gridRef} with ${data.features.length} features`);
        
        if (!map.getSource(sourceId)) {
            console.log(`Adding source for ${gridRef}`);
            map.addSource(sourceId, {
                type: 'geojson',
                data: data
            });

            // Find the first neighborhood layer to insert our tile layer before it
            const layers = map.getStyle().layers;
            let beforeLayerId;
            for (const layer of layers) {
                if (layer.id.startsWith('neighborhood-layer-')) {
                    beforeLayerId = layer.id;
                    break;
                }
            }
            
            console.log(`Adding layer for ${gridRef} before ${beforeLayerId || 'top'}`);
            
            map.addLayer({
                'id': layerId,
                'type': 'fill',
                'source': sourceId,
                'paint': {
                    'fill-color': '#FF0000',
                    'fill-opacity': 0.5
                },
                'metadata': {
                    'type': 'heatmap-tile'
                }
            }, beforeLayerId);

            loadedTiles.add(gridRef);
            console.log(`Successfully loaded tile ${gridRef}`);
            updateLayerColors(map, sourceId, layerId);
        }
    } catch (error) {
        console.error(`Error loading tile ${gridRef}:`, error);
        unloadTile(gridRef);
    } finally {
        currentlyLoadingTiles.delete(gridRef);
    }
}

// Unload a tile and remove its layers
function unloadTile(gridRef) {
    const sourceId = `tile-source-${gridRef}`;
    const layerId = `tile-layer-${gridRef}`;

    try {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(sourceId)) {
            map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
            map.removeSource(sourceId);
        }
    } catch (error) {
        console.error(`Error unloading tile ${gridRef}:`, error);
    }
    loadedTiles.delete(gridRef);
    currentlyLoadingTiles.delete(gridRef);
}

// Check which tiles need to be loaded based on viewport
async function checkVisibleTiles() {
    if (!metadata || !map) {
        console.log('Metadata or map not yet initialized');
        return;
    }

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    console.log(`Current viewport - zoom: ${zoom}, bounds: `, bounds);

    if (zoom < ZOOM_THRESHOLD) {
        console.log(`Zoom level ${zoom} below threshold ${ZOOM_THRESHOLD}, unloading all tiles`);
        Array.from(loadedTiles).forEach(unloadTile);
        return;
    }

    const viewportCenter = map.getCenter();
    console.log('Finding visible grids...');
    const visibleGrids = Object.keys(metadata)
        .filter(gridRef => {
            const visible = isGridVisible(metadata[gridRef].bounds, bounds);
            console.log(`Grid ${gridRef} visible: ${visible}`);
            return visible;
        })
        .sort((a, b) => {
            const distA = getDistanceFromCenter(a, viewportCenter);
            const distB = getDistanceFromCenter(b, viewportCenter);
            return distA - distB;
        });

    console.log(`Found ${visibleGrids.length} visible grids:`, visibleGrids);

    const tilesToLoad = visibleGrids.filter(gridRef => !loadedTiles.has(gridRef));
    console.log(`${tilesToLoad.length} tiles need loading:`, tilesToLoad);
    
    for (let i = 0; i < tilesToLoad.length; i += LOAD_BATCH_SIZE) {
        const batch = tilesToLoad.slice(i, i + LOAD_BATCH_SIZE);
        await loadTileBatch(batch);
    }

    const tilesToUnload = Array.from(loadedTiles)
        .filter(gridRef => !visibleGrids.includes(gridRef));
    
    if (tilesToUnload.length > 0) {
        console.log(`Unloading ${tilesToUnload.length} tiles:`, tilesToUnload);
        tilesToUnload.forEach(unloadTile);
    }
}

// Throttle the checkVisibleTiles function
const throttledCheckVisibleTiles = (() => {
    let timeoutId = null;
    return () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            checkVisibleTiles();
            timeoutId = null;
        }, 100);
    };
})();

// Check if a grid's bounds intersect with the viewport bounds
function isGridVisible(gridBounds, viewportBounds) {
    return !(
        gridBounds.max_lat < viewportBounds._sw.lat ||
        gridBounds.min_lat > viewportBounds._ne.lat ||
        gridBounds.max_lon < viewportBounds._sw.lng ||
        gridBounds.min_lon > viewportBounds._ne.lng
    );
}

// Load neighborhood boundaries for a state
async function loadNeighborhoodBoundaries(map, stateCode) {
    console.log('Attempting to load neighborhoods for:', stateCode);
    const sourceId = `neighborhood-source-${stateCode}`;
    const layerId = `neighborhood-layer-${stateCode}`;
    const labelLayerId = `neighborhood-label-${stateCode}`;

    try {
        const url = `${BASE_URL}/data/neighborhood-GeoJSON/ZillowNeighborhoods-${stateCode}.geojson`;
        console.log('Fetching from URL:', url);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load neighborhoods for ${stateCode} - HTTP ${response.status}`);
        }
        const data = await response.json();
        console.log(`Loaded ${data.features.length} neighborhoods for ${stateCode}`);
        
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                type: 'geojson',
                data: data
            });

            // Add neighborhood boundary layer
            map.addLayer({
                'id': layerId,
                'type': 'line',
                'source': sourceId,
                'paint': {
                    'line-color': '#000000',
                    'line-width': 2,
                    'line-opacity': 0.8
                },
                'metadata': {
                    'type': 'neighborhood'
                }
            });

            // Add neighborhood label layer (initially hidden)
            map.addLayer({
                'id': labelLayerId,
                'type': 'symbol',
                'source': sourceId,
                'layout': {
                    'text-field': ['get', 'NAME'],  // Use uppercase NAME from properties
                    'text-variable-anchor': ['center'],
                    'text-radial-offset': 0,
                    'text-justify': 'auto',
                    'text-size': 12,
                    'text-allow-overlap': false,
                    'visibility': 'none'  // Initially hidden
                },
                'paint': {
                    'text-color': '#000000',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                },
                'metadata': {
                    'type': 'neighborhood-label'
                }
            });

            console.log(`Added neighborhood layers ${layerId} and ${labelLayerId}`);
        }
    } catch (error) {
        console.error(`Error loading neighborhoods for ${stateCode}:`, error);
    }
}

// Initialize map controls
function initMapControls(map) {
    // Neighborhood names toggle
    const neighborhoodNamesToggle = document.getElementById('neighborhood-names-toggle');
    if (!neighborhoodNamesToggle) {
        console.error('Could not find neighborhood names toggle element');
        return;
    }

    neighborhoodNamesToggle.addEventListener('change', (e) => {
        const visibility = e.target.checked ? 'visible' : 'none';
        console.log(`Setting neighborhood labels visibility to: ${visibility}`);
        
        // Update all neighborhood label layers
        const style = map.getStyle();
        let layersUpdated = 0;
        
        style.layers.forEach(layer => {
            if (layer.metadata && layer.metadata.type === 'neighborhood-label') {
                map.setLayoutProperty(layer.id, 'visibility', visibility);
                layersUpdated++;
                console.log(`Updated visibility for layer: ${layer.id}`);
            }
        });
        
        console.log(`Updated visibility for ${layersUpdated} neighborhood label layers`);
    });
}

// Initialize tile loader
async function initTileLoader(mapInstance) {
    console.log('Initializing tile loader');
    map = mapInstance;

    try {
        console.log('Loading metadata...');
        metadata = await loadMetadata();
        if (metadata) {
            console.log('Metadata loaded, checking visible tiles...');
            checkVisibleTiles();
        }
    } catch (error) {
        console.error('Error during initialization:', error);
    }

    // Add event listeners for map movements
    map.on('move', throttledCheckVisibleTiles);
    map.on('moveend', throttledCheckVisibleTiles);
    map.on('zoom', throttledCheckVisibleTiles);
    map.on('zoomend', throttledCheckVisibleTiles);
}

// Initialize neighborhood loader
function initNeighborhoodLoader(map) {
    console.log('Initializing neighborhood loader');
    loadNeighborhoodBoundaries(map, 'TX');

    map.on('moveend', () => {
        const center = map.getCenter();
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${center.lng},${center.lat}.json?access_token=${mapboxgl.accessToken}`)
            .then(response => response.json())
            .then(data => {
                const state = data.features.find(f => f.place_type.includes('region'));
                if (state && state.properties && state.properties.short_code) {
                    const stateCode = state.properties.short_code.split('-')[1];
                    loadNeighborhoodBoundaries(map, stateCode);
                }
            })
            .catch(error => console.error('Error getting state:', error));
    });
}

// Export both initialization functions
export { initTileLoader, initNeighborhoodLoader, initMapControls };
