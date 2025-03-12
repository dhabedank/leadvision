// Global variables
let rawData = [];
let filteredData = [];
let charts = {};
let isDataLoaded = false;

// Debug helper
function log(message, data) {
    const debugElement = document.getElementById('debugInfo');
    const timestamp = new Date().toLocaleTimeString();
    let entry = `[${timestamp}] ${message}`;

    if (data !== undefined) {
        try {
            if (typeof data === 'object') {
                entry += ': ' + JSON.stringify(data).substring(0, 200);
                if (JSON.stringify(data).length > 200) {
                    entry += '...';
                }
            } else {
                entry += ': ' + data;
            }
        } catch (e) {
            entry += ': [Object cannot be stringified]';
        }
    }

    debugElement.innerHTML += entry + '<br>';
    debugElement.scrollTop = debugElement.scrollHeight;
    console.log(message, data);
}

// Toggle debug panel
function toggleDebug() {
    const debugElement = document.getElementById('debugInfo');
    debugElement.style.display = debugElement.style.display === 'none' ? 'block' : 'none';
}

// Helper function for date parsing
function parseDate(dateStr) {
    if (!dateStr) return null;

    try {
        // Handle if dateStr is already a Date
        if (dateStr instanceof Date) return dateStr;

        // Try standard Date parsing
        const date = new Date(dateStr);

        // If the result is a valid date, return it
        if (!isNaN(date.getTime())) {
            return date;
        }

        // If we get here, try to parse manually for MM/DD/YYYY format
        if (typeof dateStr === 'string' && dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                // JS months are 0-indexed, so subtract 1 from the month
                const month = parseInt(parts[0], 10) - 1;
                const day = parseInt(parts[1], 10);
                const year = parseInt(parts[2], 10);

                // Create a new date with the parsed components
                return new Date(year, month, day);
            }
        }

        // If all else fails, return null
        return null;
    } catch (e) {
        log('Error parsing date', e);
        return null;
    }
}

// Format currency
function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

// Set up tabs
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(t => {
                t.classList.remove('active');
            });

            // Add active class to clicked tab
            this.classList.add('active');

            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            // Show content for clicked tab
            const tabId = this.dataset.tab;
            document.getElementById(tabId).classList.add('active');
        });
    });
});

// Process data and calculate monthly metrics
function processMonthlyData(data) {
    log('Processing monthly data', `${data.length} rows`);
    
    // For lead counts, use the base filtered data (before source filtering)
    // This ensures lead counts stay consistent regardless of source filter
    const baseData = window.baseFilteredData || data;
    log('Using base data for lead counts', `${baseData.length} rows`);

    // Object to store monthly data
    const months = {};

    try {
        // Process leads based on First Delivery Time - use baseData for lead counts
        baseData.forEach(row => {
            if (row['First Delivery Time']) {
                const date = parseDate(row['First Delivery Time']);

                if (date && !isNaN(date.getTime())) {
                    // Create year-month key (e.g. "2023-01")
                    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

                    // Initialize month data if not exists
                    if (!months[yearMonth]) {
                        months[yearMonth] = {
                            month: yearMonth,
                            leads: 0,
                            closings: 0,
                            closingValue: 0,
                            spillover: 0
                        };
                    }

                    // Count lead
                    months[yearMonth].leads += 1;

                    // Count spillover if agent is assigned
                    if (row.Agent && row.Agent !== '') {
                        months[yearMonth].spillover += 1;
                    }
                }
            }
        });

        // Process closings based on Purchased Sale Date - use filtered data for closing counts
        // This ensures only the selected source's closings are counted
        data.forEach(row => {
            // Skip if marked to exclude from closing counts
            if (row._excludeFromClosingCounts) return;
            // Determine if this row should be counted as a closing based on filter settings
            let countAsClosing = false;
            const closingsType = document.getElementById('closingsTypeFilter').value;
            const brokerName = document.getElementById('brokerNameInput').value.trim().toLowerCase();
            
            // First, check if we have a purchase date
            if (row['purchased sale date']) {
                // Check if date is in the past (not future dates)
                const purchaseDate = parseDate(row['purchased sale date']);
                const now = new Date();
                
                if (purchaseDate && purchaseDate <= now) {
                    // For all closings, count any valid past purchase date
                    if (closingsType === 'all') {
                        countAsClosing = true;
                    }
                    // For client closings, we need to meet additional criteria
                    else if (closingsType === 'client') {
                        // Count as client closing if it's Market VIP with Close status
                        if (row['Source'] === 'Market VIP' && row['Status'] === 'Close') {
                            countAsClosing = true;
                        }
                        // Count as client closing if it's OpCity with Close status
                        else if (row['Source'] === 'OpCity' && row['Status'] === 'Close') {
                            countAsClosing = true;
                        }
                        // Or if broker name matches user input
                        else if (brokerName && 
                                row['purchased buyer broker'] && 
                                row['purchased buyer broker'].toLowerCase().includes(brokerName)) {
                            countAsClosing = true;
                        }
                    }
                }
            }
            
            if (countAsClosing) {
                const date = parseDate(row['purchased sale date']);

                if (date && !isNaN(date.getTime())) {
                    // Check if the date is in the past
                    const now = new Date();
                    if (date > now) {
                        // Skip future closings
                        return;
                    }
                    
                    // Create year-month key
                    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

                    // Initialize month data if not exists
                    if (!months[yearMonth]) {
                        months[yearMonth] = {
                            month: yearMonth,
                            leads: 0,
                            closings: 0,
                            closingValue: 0,
                            spillover: 0
                        };
                    }

                    // Count closing
                    months[yearMonth].closings += 1;

                    // Add closing value if available
                    let purchaseValue = 0;
                    if (row['purchased value']) {
                        if (typeof row['purchased value'] === 'string') {
                            purchaseValue = parseFloat(row['purchased value'].replace(/[^0-9.-]+/g, '')) || 0;
                        } else {
                            purchaseValue = row['purchased value'] || 0;
                        }
                    }
                    months[yearMonth].closingValue += purchaseValue;
                }
            }
        });

        // Convert months object to sorted array
        const monthsArray = Object.entries(months).map(([month, data]) => {
            // Calculate derived metrics
            const conversionRate = data.leads > 0 ? (data.closings / data.leads) * 100 : 0;
            const spilloverRate = data.leads > 0 ? (data.spillover / data.leads) * 100 : 0;

            // Add display month string
            const date = new Date(`${month}-01`);
            const displayMonth = date.toLocaleDateString('en-US', {
                month: 'short',
                year: '2-digit'
            });

            return {
                ...data,
                conversionRate,
                spilloverRate,
                displayMonth
            };
        }).sort((a, b) => a.month.localeCompare(b.month));

        log('Monthly data processed', `${monthsArray.length} months`);

        return monthsArray;
    } catch (err) {
        log('Error in processMonthlyData', err);
        return [];
    }
}

// Process price range data
function processPriceRangeData(data) {
    log('Processing price range data');

    try {
        // Define price range buckets
        const priceRanges = {
            'Unknown': { name: 'Unknown', leads: 0, closings: 0 },
            'Less Than $60K': { name: 'Less Than $60K', leads: 0, closings: 0 },
            '$60K-$100K': { name: '$60K-$100K', leads: 0, closings: 0 },
            '$100K-$300K': { name: '$100K-$300K', leads: 0, closings: 0 },
            '$300K-$500K': { name: '$300K-$500K', leads: 0, closings: 0 },
            '$500K-$1M': { name: '$500K-$1M', leads: 0, closings: 0 },
            '$1M+': { name: '$1M+', leads: 0, closings: 0 }
        };

        // Process each row
        data.forEach(row => {
            // Determine price range from Client Price Range field
            let priceRange = 'Unknown';

            if (row['Client Price Range']) {
                const rangeStr = String(row['Client Price Range']).toUpperCase();
                if (rangeStr.includes('$300K-$500K')) {
                    priceRange = '$300K-$500K';
                } else if (rangeStr.includes('$150K-$300K') || rangeStr.includes('$100K-$300K')) {
                    priceRange = '$100K-$300K';
                } else if (rangeStr.includes('<$150K') || rangeStr.includes('<$100K') || rangeStr.includes('<$60K')) {
                    priceRange = 'Less Than $60K';
                } else if (rangeStr.includes('$500K-$1M') || rangeStr.includes('$500K')) {
                    priceRange = '$500K-$1M';
                } else if (rangeStr.includes('$1M') || rangeStr.includes('$1 MILLION')) {
                    priceRange = '$1M+';
                } else if (rangeStr.includes('$60K-$100K')) {
                    priceRange = '$60K-$100K';
                }
            }

            // Increment lead count for this price range
            if (priceRanges[priceRange]) {
                priceRanges[priceRange].leads++;

                // Check if lead became a closing
                if (row['purchased sale date']) {
                    priceRanges[priceRange].closings++;
                }
            }
        });

        // Calculate conversion rates and convert to array
        const result = Object.values(priceRanges).map(range => ({
            ...range,
            conversionRate: range.leads > 0 ? (range.closings / range.leads) * 100 : 0
        })).filter(range => range.leads > 0).sort((a, b) => b.leads - a.leads);

        log('Price range data processed', `${result.length} ranges`);

        return result;
    } catch (err) {
        log('Error in processPriceRangeData', err);
        return [];
    }
}

// Process delivery method data
function processDeliveryMethodData(data) {
    log('Processing delivery method data');

    try {
        // Object to store delivery method counts
        const methods = {};

        // Process each row
        data.forEach(row => {
            const method = row['Delivery Type'] || 'Unknown';

            // Initialize if not exists
            if (!methods[method]) {
                methods[method] = {
                    type: method,
                    total: 0,
                    closings: 0
                };
            }

            // Count lead
            methods[method].total++;

            // Check if lead became a closing
            if (row['purchased sale date']) {
                methods[method].closings++;
            }
        });

        // Calculate conversion rates and convert to array
        const result = Object.values(methods).map(method => ({
            ...method,
            conversionRate: method.total > 0 ? (method.closings / method.total) * 100 : 0
        })).sort((a, b) => b.total - a.total);

        log('Delivery method data processed', `${result.length} methods`);

        return result;
    } catch (err) {
        log('Error in processDeliveryMethodData', err);
        return [];
    }
}

// Process zip code data
function processZipCodeData(data) {
    log('Processing zip code data');

    try {
        // Object to store zip code counts
        const zipCodes = {};

        // Process each row
        data.forEach(row => {
            const zip = row['Property Inquiry Zip'];

            // Skip if zip is missing
            if (!zip || zip === 'Unknown') return;

            // Initialize if not exists
            if (!zipCodes[zip]) {
                zipCodes[zip] = {
                    zip: String(zip),
                    leads: 0,
                    closings: 0
                };
            }

            // Count lead
            zipCodes[zip].leads++;

            // Check if lead became a closing
            if (row['purchased sale date']) {
                zipCodes[zip].closings++;
            }
        });

        // Calculate conversion rates and convert to array
        const result = Object.values(zipCodes)
            .map(zip => ({
                ...zip,
                conversionRate: zip.leads > 0 ? (zip.closings / zip.leads) * 100 : 0
            }))
            .filter(zip => zip.leads >= 5) // Only include zips with at least 5 leads
            .sort((a, b) => b.leads - a.leads)
            .slice(0, 10); // Get top 10 by lead count

        log('Zip code data processed', `${result.length} zip codes`);

        return result;
    } catch (err) {
        log('Error in processZipCodeData', err);
        return [];
    }
}

// Process closings data
function processClosingsData(data) {
    log('Processing closings data');

    try {
        // Filter to rows with purchase date
        const closings = data.filter(row => row['purchased sale date']).map(row => {
            // Format dates
            const deliveryDate = parseDate(row['First Delivery Time']);
            const purchaseDate = parseDate(row['purchased sale date']);

            // Parse purchase value
            let purchaseValue = 0;
            if (row['purchased value']) {
                if (typeof row['purchased value'] === 'string') {
                    purchaseValue = parseFloat(row['purchased value'].replace(/[^0-9.-]+/g, '')) || 0;
                } else {
                    purchaseValue = row['purchased value'] || 0;
                }
            }

            return {
                clientName: row['Client Name'] || 'Unknown',
                deliveryDate: deliveryDate ? deliveryDate.toLocaleDateString() : 'Unknown',
                purchaseDate: purchaseDate ? purchaseDate.toLocaleDateString() : 'Unknown',
                type: row['Delivery Type'] || 'Unknown',
                source: row['Source'] || 'Unknown',
                status: row['Status'] || 'Unknown',
                salesPrice: purchaseValue
            };
        }).sort((a, b) => {
            // Sort by purchase date, most recent first
            const dateA = parseDate(a.purchaseDate);
            const dateB = parseDate(b.purchaseDate);

            if (!dateA && !dateB) return 0;
            if (!dateA) return 1;
            if (!dateB) return -1;

            return dateB.getTime() - dateA.getTime();
        });

        log('Closings data processed', `${closings.length} closings`);

        return closings;
    } catch (err) {
        log('Error in processClosingsData', err);
        return [];
    }
}

// Initialize filters
function initializeFilters(data) {
    log('Initializing filters');

    try {
        // Add source filter
        const sources = [...new Set(data.map(row => row.Source).filter(Boolean))];
        const sourceSelect = document.getElementById('sourceFilter');
        sourceSelect.innerHTML = '<option value="all">All Sources</option>';
        sources.sort().forEach(source => {
            const option = document.createElement('option');
            option.value = source;
            option.textContent = source;
            sourceSelect.appendChild(option);
        });

        // Extract unique markets with market type indicators
        const marketData = {};
        data.forEach(row => {
            if (row.Market) {
                const market = row.Market.trim();
                if (!marketData[market]) {
                    marketData[market] = {
                        marketTypes: new Set()
                    };
                }
                if (row.Market_Type) {
                    marketData[market].marketTypes.add(row.Market_Type);
                }
            }
        });
        
        // Create the market multi-select options
        const marketSelect = document.getElementById('marketFilter');
        marketSelect.innerHTML = '';
        Object.keys(marketData).sort().forEach(market => {
            const option = document.createElement('option');
            option.value = market;
            
            // If we have market type info, add indicators
            const marketTypes = Array.from(marketData[market].marketTypes);
            let labelText = market;
            
            if (marketTypes.includes('OpCity') && marketTypes.includes('Market VIP')) {
                labelText += ' (OpCity & Market VIP)';
            } else if (marketTypes.includes('OpCity')) {
                labelText += ' (OpCity)';
            } else if (marketTypes.includes('Market VIP')) {
                labelText += ' (Market VIP)';
            }
            
            option.textContent = labelText;
            marketSelect.appendChild(option);
        });

        // Extract unique lead zones (from Market VIP leads)
        const zones = [...new Set(data.map(row => row['Lead Zone']).filter(Boolean))];
        const zoneSelect = document.getElementById('zoneFilter');
        zoneSelect.innerHTML = '<option value="all">All Zones</option>';
        zones.sort().forEach(zone => {
            const option = document.createElement('option');
            option.value = zone;
            option.textContent = `Zone ${zone}`;
            zoneSelect.appendChild(option);
        });

        // Extract unique years from First Delivery Time
        const years = [...new Set(data
            .map(row => {
                const date = parseDate(row['First Delivery Time']);
                return date ? date.getFullYear() : null;
            })
            .filter(Boolean))];
        const yearSelect = document.getElementById('yearFilter');
        yearSelect.innerHTML = '<option value="all">All Years</option>';
        years.sort().reverse().forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearSelect.appendChild(option);
        });

        // Add event listeners to filters
        document.getElementById('sourceFilter').addEventListener('change', applyFilters);
        document.getElementById('marketFilter').addEventListener('change', applyFilters);
        document.getElementById('zoneFilter').addEventListener('change', applyFilters);
        document.getElementById('yearFilter').addEventListener('change', applyFilters);
        document.getElementById('closingsTypeFilter').addEventListener('change', function() {
            const showBrokerInput = this.value === 'client';
            document.querySelector('.broker-input-group').style.display = showBrokerInput ? 'block' : 'none';
            // Directly update dashboard since this doesn't require refiltering data
            updateDashboard();
        });
        document.getElementById('brokerNameInput').addEventListener('input', function() {
            // Directly update dashboard for broker name changes too
            updateDashboard();
        });

        log('Filters initialized', { 
            sources: sources.length,
            markets: Object.keys(marketData).length, 
            zones: zones.length, 
            years: years.length 
        });
    } catch (err) {
        log('Error in initializeFilters', err);
    }
}

// Apply filters to data
function applyFilters() {
    log('Applying filters');

    try {
        const source = document.getElementById('sourceFilter').value;
        const selectedMarkets = Array.from(document.getElementById('marketFilter').selectedOptions).map(o => o.value);
        const zone = document.getElementById('zoneFilter').value;
        const year = document.getElementById('yearFilter').value;
        const closingsType = document.getElementById('closingsTypeFilter').value;
        const brokerName = document.getElementById('brokerNameInput').value.trim().toLowerCase();

        log('Filter values', { 
            source, 
            selectedMarkets, 
            zone, 
            year, 
            closingsType,
            brokerName: brokerName || '(none)' 
        });

        // Apply all filters including source to the base data
        const baseFilteredData = rawData.filter(row => {
            // Filter by market (multi-select)
            if (selectedMarkets.length > 0 && (!row.Market || !selectedMarkets.includes(row.Market.trim()))) {
                return false;
            }

            // Filter by zone
            if (zone !== 'all' && String(row['Lead Zone']) !== zone) {
                return false;
            }

            // Filter by year
            if (year !== 'all') {
                const date = parseDate(row['First Delivery Time']);
                if (!date || date.getFullYear() !== parseInt(year)) {
                    return false;
                }
            }
            
            // Apply source filter to base data as well
            if (source !== 'all' && row.Source !== source) {
                return false;
            }

            return true;
        });
        
        // Store the base filtered data for proper lead counting
        window.baseFilteredData = baseFilteredData;
        
        // Apply client closing filter to the display data
        // The lead counts will be based on baseFilteredData which already includes source filter
        filteredData = baseFilteredData.filter(row => {
            
            // Client closing filter - only apply to purchased records, not to leads
            if (closingsType === 'client' && row['purchased sale date']) {
                const isClosed = row.Status === 'Close';
                const hasMatchingBroker = 
                    brokerName && 
                    row['purchased buyer broker'] && 
                    row['purchased buyer broker'].toLowerCase().includes(brokerName);
                
                // For client closings, it must be client's closing
                if (!isClosed && !hasMatchingBroker) {
                    // Mark this row to exclude from closing counts
                    row._excludeFromClosingCounts = true;
                }
            }

            return true;
        });

        log('Filtered data', {
            base: baseFilteredData.length,
            filtered: filteredData.length
        });

        // Update dashboard with filtered data
        updateDashboard();
    } catch (err) {
        log('Error in applyFilters', err);
    }
}

// Update dashboard with current filtered data
function updateDashboard() {
    log('Updating dashboard');

    try {
        // Process data
        const monthlyData = processMonthlyData(filteredData);
        const priceRangeData = processPriceRangeData(filteredData);
        const deliveryMethodData = processDeliveryMethodData(filteredData);
        const zipCodeData = processZipCodeData(filteredData);
        const closingsData = processClosingsData(filteredData);

        // Update all dashboard components
        updateSummaryMetrics(monthlyData);
        updatePerformanceChart(monthlyData);
        updateConversionChart(monthlyData);
        updatePriceRangeChart(priceRangeData);
        updateDeliveryMethodChart(deliveryMethodData);
        updateZipCodeChart(zipCodeData);
        updateLeadFlowTable(monthlyData);
        updateClosingsTable(closingsData);

        log('Dashboard updated successfully');
    } catch (err) {
        log('Error in updateDashboard', err);
    }
}

// Update summary metrics
function updateSummaryMetrics(monthlyData) {
    log('Updating summary metrics');

    try {
        // Calculate overall metrics
        const totalLeads = monthlyData.reduce((sum, month) => sum + month.leads, 0);
        const totalClosings = monthlyData.reduce((sum, month) => sum + month.closings, 0);
        const totalClosingValue = monthlyData.reduce((sum, month) => sum + month.closingValue, 0);
        const conversionRate = totalLeads > 0 ? (totalClosings / totalLeads) * 100 : 0;

        // Update DOM
        const summaryContainer = document.getElementById('summaryMetrics');
        summaryContainer.innerHTML = `
            <div class="metric-box">
                <div class="metric-label">Total Leads</div>
                <div class="metric-value">${totalLeads.toLocaleString()}</div>
            </div>
            <div class="metric-box">
                <div class="metric-label">Total Closings</div>
                <div class="metric-value">${totalClosings.toLocaleString()}</div>
            </div>
            <div class="metric-box positive">
                <div class="metric-label">Conversion Rate</div>
                <div class="metric-value">${conversionRate.toFixed(2)}%</div>
            </div>
            <div class="metric-box">
                <div class="metric-label">Total Closing Value</div>
                <div class="metric-value">${formatCurrency(totalClosingValue)}</div>
            </div>
        `;

        log('Summary metrics updated');
    } catch (err) {
        log('Error in updateSummaryMetrics', err);
    }
}

// Update performance chart
function updatePerformanceChart(monthlyData) {
    log('Updating performance chart');

    try {
        const ctx = document.getElementById('performanceChart').getContext('2d');

        // Limit to last 24 months for better visibility
        const recentData = monthlyData.slice(-24);

        // Destroy existing chart if it exists
        if (charts.performance) {
            charts.performance.destroy();
        }

        // Create new chart
        charts.performance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: recentData.map(item => item.displayMonth),
                datasets: [
                    {
                        label: 'Leads Received',
                        backgroundColor: 'rgba(227, 224, 221, 0.5)',
                        borderColor: '#2d292b',
                        data: recentData.map(item => item.leads),
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#2d292b',
                        order: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Closings',
                        backgroundColor: 'rgba(217, 34, 40, 0.3)',
                        borderColor: '#d92228',
                        data: recentData.map(item => item.closings),
                        fill: true,
                        tension: 0.3,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#d92228',
                        borderWidth: 3,
                        order: 1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.raw;
                                return `${label}: ${value.toLocaleString()}`;
                            }
                        }
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Leads'
                        },
                        position: 'left',
                        ticks: {
                            precision: 0,
                            stepSize: Math.max(1, Math.ceil(Math.max(...recentData.map(item => item.leads)) / 10))
                        }
                    },
                    y1: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Closings'
                        },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            precision: 0,
                            stepSize: Math.max(1, Math.ceil(Math.max(...recentData.map(item => item.closings)) / 5))
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const clickedIndex = elements[0].index;
                        const monthData = recentData[clickedIndex];
                        
                        // Check which dataset was clicked
                        const isClosings = elements[0].datasetIndex === 1;
                        
                        // Show details for the month
                        showMonthDetails(monthData, isClosings);
                    }
                }
            }
        });

        // Add a notice below the chart
        const chartContainer = document.getElementById('performanceChart').parentNode;
        let noticeElement = document.getElementById('chartClickNotice');
        
        if (!noticeElement) {
            noticeElement = document.createElement('div');
            noticeElement.id = 'chartClickNotice';
            noticeElement.className = 'chart-notice';
            noticeElement.innerHTML = 'Click on any data point to see details';
            chartContainer.appendChild(noticeElement);
        }
        
        log('Performance chart updated');
    } catch (err) {
        log('Error in updatePerformanceChart', err);
    }
}

// Show month details when clicking on chart points
function showMonthDetails(monthData, isClosings) {
    log('Showing details for month', monthData.displayMonth);
    
    let relevantLeads;
    
    if (isClosings) {
        // For closings, filter by purchase date month
        const closingsType = document.getElementById('closingsTypeFilter').value;
        const brokerName = document.getElementById('brokerNameInput').value.trim().toLowerCase();
        
        relevantLeads = filteredData.filter(lead => {
            // 1. Must have a purchase date
            if (!lead['purchased sale date']) return false;
            
            // 2. Purchase date must be in the past
            const purchaseDate = parseDate(lead['purchased sale date']);
            const now = new Date();
            if (!purchaseDate || purchaseDate > now) return false;
            
            // 3. Purchase date must match the month we're viewing
            const purchaseYearMonth = `${purchaseDate.getFullYear()}-${String(purchaseDate.getMonth() + 1).padStart(2, '0')}`;
            if (purchaseYearMonth !== monthData.month) return false;
            
            // 4. For client closings, apply additional filters
            if (closingsType === 'client') {
                return lead.Status === 'Close' || 
                      (brokerName && 
                       lead['purchased buyer broker'] && 
                       lead['purchased buyer broker'].toLowerCase().includes(brokerName));
            }
            
            // For "all closings", any valid past purchase date in the correct month is fine
            return true;
        });
    } else {
        // For leads, filter by delivery date month
        relevantLeads = filteredData.filter(lead => {
            const leadDate = parseDate(lead['First Delivery Time']);
            if (!leadDate) return false;
            
            const leadYearMonth = `${leadDate.getFullYear()}-${String(leadDate.getMonth() + 1).padStart(2, '0')}`;
            return leadYearMonth === monthData.month;
        });
    }
    
    // Create/update month details panel
    let detailsPanel = document.getElementById('monthDetailsPanel');
    
    if (!detailsPanel) {
        detailsPanel = document.createElement('div');
        detailsPanel.id = 'monthDetailsPanel';
        detailsPanel.className = 'panel panel-full month-details-panel';
        
        // Insert after the performance chart panel
        const performancePanel = document.getElementById('performanceChart').closest('.panel');
        performancePanel.parentNode.insertBefore(detailsPanel, performancePanel.nextSibling);
    }
    
    // Define all the columns that we want to show
    const commonColumns = [
        { field: 'Client Name', label: 'Client Name' },
        { field: 'Client Email', label: 'Email' },
        { field: 'Client Phone', label: 'Phone' },
        { field: 'Source', label: 'Source' },
        { field: 'Market', label: 'Market' },
        { field: 'Lead Zone', label: 'Zone' },
        { field: 'Status', label: 'Status' },
        { field: 'Agent', label: 'Agent' }
    ];
    
    const leadColumns = [
        { field: 'First Delivery Time', label: 'Delivery Date', format: value => parseDate(value)?.toLocaleDateString() || '-' },
        { field: 'Delivery Type', label: 'Delivery Type' },
        { field: 'Property Inquiry Zip', label: 'Zip Code' },
        { field: 'Client Price Range', label: 'Price Range' },
        { field: 'Transaction', label: 'Transaction' }
    ];
    
    const closingColumns = [
        { field: 'purchased sale date', label: 'Closing Date' },
        { field: 'purchased address', label: 'Property Address' },
        { field: 'purchased value', label: 'Value', format: value => value ? formatCurrency(parseFloat(value)) : '-' },
        { field: 'purchased buyer broker', label: 'Buyer Broker' }
    ];
    
    // Columns to display based on the view type
    const columnsToDisplay = isClosings 
        ? [...commonColumns, ...closingColumns] 
        : [...commonColumns, ...leadColumns];
    
    // Set panel content
    detailsPanel.innerHTML = `
        <div class="panel-header">
            <h3 class="panel-title">${isClosings ? 'Closings' : 'Leads'} for ${monthData.displayMonth}</h3>
            <div class="panel-actions">
                <button class="export-btn" onclick="exportDetailData(${JSON.stringify(monthData.month)}, ${isClosings})">
                    <i class="download-icon small"></i> Export
                </button>
                <button class="close-btn" onclick="document.getElementById('monthDetailsPanel').remove()">×</button>
            </div>
        </div>
        <div class="panel-body">
            <p>${relevantLeads.length} ${isClosings ? 'closings' : 'leads'} in this period</p>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            ${columnsToDisplay.map(col => `<th>${col.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${relevantLeads.map(lead => `
                            <tr>
                            ${columnsToDisplay.map(col => {
                                const value = lead[col.field] || '-';
                                return `<td>${col.format ? col.format(value) : value}</td>`;
                            }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    // Scroll to the details panel
    detailsPanel.scrollIntoView({ behavior: 'smooth' });
}

// Function to export detailed data for a specific month
function exportDetailData(month, isClosings) {
    let relevantLeads;
    
    if (isClosings) {
        // For closings, filter by purchase date month
        const closingsType = document.getElementById('closingsTypeFilter').value;
        const brokerName = document.getElementById('brokerNameInput').value.trim().toLowerCase();
        
        relevantLeads = filteredData.filter(lead => {
            // 1. Must have a purchase date
            if (!lead['purchased sale date']) return false;
            
            // 2. Purchase date must be in the past
            const purchaseDate = parseDate(lead['purchased sale date']);
            const now = new Date();
            if (!purchaseDate || purchaseDate > now) return false;
            
            // 3. Purchase date must match the month we're viewing
            const purchaseYearMonth = `${purchaseDate.getFullYear()}-${String(purchaseDate.getMonth() + 1).padStart(2, '0')}`;
            if (purchaseYearMonth !== month) return false;
            
            // 4. For client closings, apply additional filters
            if (closingsType === 'client') {
                return lead.Status === 'Close' || 
                      (brokerName && 
                       lead['purchased buyer broker'] && 
                       lead['purchased buyer broker'].toLowerCase().includes(brokerName));
            }
            
            // For "all closings", any valid past purchase date in the correct month is fine
            return true;
        });
    } else {
        // For leads, filter by delivery date month
        relevantLeads = filteredData.filter(lead => {
            const leadDate = parseDate(lead['First Delivery Time']);
            if (!leadDate) return false;
            
            const leadYearMonth = `${leadDate.getFullYear()}-${String(leadDate.getMonth() + 1).padStart(2, '0')}`;
            return leadYearMonth === month;
        });
    }
    
    // Define all columns for the export
    const columns = [
        'Client Name', 'Client Phone', 'Client Email', 'First Delivery Time', 
        'Property Inquiry Zip', 'Client Price Range', 'Delivery Type', 
        'Agent', 'Transaction', 'Status', 'Market', 'Lead Zone', 'Source',
        'Market Type', 'purchased sale date', 'purchased address', 
        'purchased value', 'purchased buyer broker'
    ];
    
    // Use PapaParse to create CSV
    const csv = Papa.unparse({
        fields: columns,
        data: relevantLeads
    });
    
    // Create a blob and download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const monthDate = new Date(`${month}-01`);
    const monthName = monthDate.toLocaleString('default', { month: 'short', year: 'numeric' });
    const filename = `${isClosings ? 'closings' : 'leads'}_${monthName.replace(' ', '_')}.csv`;
    
    // Create download link and trigger click
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    log('Month details export complete', { 
        month: monthName, 
        type: isClosings ? 'closings' : 'leads',
        rows: relevantLeads.length 
    });
}

// Update conversion chart
function updateConversionChart(monthlyData) {
    log('Updating conversion chart');

    try {
        const ctx = document.getElementById('conversionChart').getContext('2d');

        // Limit to last 24 months for better visibility
        const recentData = monthlyData.slice(-24);

        // Destroy existing chart if it exists
        if (charts.conversion) {
            charts.conversion.destroy();
        }

        // Create new chart
        charts.conversion = new Chart(ctx, {
            type: 'line',
            data: {
                labels: recentData.map(item => item.displayMonth),
                datasets: [
                    {
                        label: 'Conversion Rate (%)',
                        data: recentData.map(item => item.conversionRate),
                        borderColor: '#d92228',
                        backgroundColor: 'rgba(217, 34, 40, 0.2)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Conversion Rate: ${context.raw.toFixed(2)}%`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Conversion Rate (%)'
                        },
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });

        log('Conversion chart updated');
    } catch (err) {
        log('Error in updateConversionChart', err);
    }
}

// Update price range chart
function updatePriceRangeChart(priceRangeData) {
    log('Updating price range chart');

    try {
        const ctx = document.getElementById('priceRangeChart').getContext('2d');

        // Destroy existing chart if it exists
        if (charts.priceRange) {
            charts.priceRange.destroy();
        }

        // Create new chart
        charts.priceRange = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: priceRangeData.map(item => item.name),
                datasets: [
                    {
                        label: 'Leads by Price Range',
                        data: priceRangeData.map(item => item.leads),
                        backgroundColor: [
                            '#d92228', '#2d292b', '#e3e0dd', '#b01c21', '#1a1819',
                            '#c8c4c0', '#90888a'
                        ]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.raw;
                                const total = priceRangeData.reduce((sum, item) => sum + item.leads, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${context.label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        log('Price range chart updated');
    } catch (err) {
        log('Error in updatePriceRangeChart', err);
    }
}

// Update delivery method chart
function updateDeliveryMethodChart(deliveryMethodData) {
    log('Updating delivery method chart');

    try {
        const ctx = document.getElementById('deliveryMethodChart').getContext('2d');

        // Destroy existing chart if it exists
        if (charts.deliveryMethod) {
            charts.deliveryMethod.destroy();
        }

        // Create new chart
        charts.deliveryMethod = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: deliveryMethodData.map(item => item.type),
                datasets: [
                    {
                        label: 'Leads by Delivery Method',
                        data: deliveryMethodData.map(item => item.total),
                        backgroundColor: [
                            '#d92228', '#2d292b', '#e3e0dd', '#b01c21', '#1a1819'
                        ]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.raw;
                                const total = deliveryMethodData.reduce((sum, item) => sum + item.total, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${context.label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        log('Delivery method chart updated');
    } catch (err) {
        log('Error in updateDeliveryMethodChart', err);
    }
}

// Update zip code chart
function updateZipCodeChart(zipCodeData) {
    log('Updating zip code chart');

    try {
        const ctx = document.getElementById('zipCodeChart').getContext('2d');

        // Destroy existing chart if it exists
        if (charts.zipCode) {
            charts.zipCode.destroy();
        }

        // Create new chart
        charts.zipCode = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: zipCodeData.map(item => item.zip),
                datasets: [
                    {
                        label: 'Leads',
                        data: zipCodeData.map(item => item.leads),
                        backgroundColor: '#2d292b',
                        order: 1
                    },
                    {
                        label: 'Conversion Rate (%)',
                        data: zipCodeData.map(item => item.conversionRate),
                        backgroundColor: '#d92228',
                        type: 'line',
                        yAxisID: 'conversion',
                        borderColor: '#d92228',
                        borderWidth: 2,
                        order: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.raw;

                                if (label === 'Conversion Rate (%)') {
                                    return `${label}: ${value.toFixed(1)}%`;
                                }

                                return `${label}: ${value}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Leads'
                        }
                    },
                    'conversion': {
                        position: 'right',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Conversion Rate (%)'
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });

        log('Zip code chart updated');
    } catch (err) {
        log('Error in updateZipCodeChart', err);
    }
}

// Update lead flow table
function updateLeadFlowTable(monthlyData) {
    log('Updating lead flow table');

    try {
        const tableBody = document.querySelector('#leadFlowTable tbody');
        tableBody.innerHTML = '';

        // Get most recent 6 months
        const recentMonths = [...monthlyData].reverse().slice(0, 6);

        // Add rows for each month
        recentMonths.forEach(month => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${month.displayMonth}</td>
                <td>${month.leads.toLocaleString()}</td>
                <td>${month.spillover.toLocaleString()}</td>
                <td>${month.spilloverRate.toFixed(2)}%</td>
            `;
            tableBody.appendChild(row);
        });

        log('Lead flow table updated');
    } catch (err) {
        log('Error in updateLeadFlowTable', err);
    }
}

// Update closings table
function updateClosingsTable(closingsData) {
    log('Updating closings table');

    try {
        const tableBody = document.querySelector('#closingsTable tbody');
        tableBody.innerHTML = '';

        // Display top 10 most recent closings
        const recentClosings = closingsData.slice(0, 10);

        // Add rows for each closing
        recentClosings.forEach(closing => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${closing.clientName}</td>
                <td>${closing.deliveryDate}</td>
                <td>${closing.purchaseDate}</td>
                <td>${closing.type}</td>
                <td>${closing.source}</td>
                <td>${closing.status}</td>
                <td>${formatCurrency(closing.salesPrice)}</td>
            `;
            tableBody.appendChild(row);
        });

        log('Closings table updated');
    } catch (err) {
        log('Error in updateClosingsTable', err);
    }
}

// Function to normalize the list price into price range categories
function normalizePriceRange(listPrice) {
    if (!listPrice || listPrice === null || listPrice === "") return "Unknown";

    // If already in the correct format (e.g., "$150K-$300K"), return as is
    if (
        typeof listPrice === "string" &&
        listPrice.includes("$") &&
        (listPrice.includes("K") || listPrice.includes("M"))
    ) {
        return listPrice;
    }

    // Convert to number for comparison
    let price;
    if (typeof listPrice === "string") {
        // Remove non-numeric characters except decimal points
        const numericValue = listPrice.replace(/[^0-9.]/g, "");
        price = parseFloat(numericValue);
    } else {
        price = parseFloat(listPrice);
    }

    if (isNaN(price)) return "Unknown";

    if (price < 60000) return "Less Than $60K";
    if (price < 100000) return "$60K-$100K";
    if (price < 150000) return "$100K-$150K";
    if (price < 300000) return "$150K-$300K";
    if (price < 500000) return "$300K-$500K";
    if (price < 1000000) return "$500K-$1M";
    return "$1M+";
}

// Clean and standardize phone numbers
function cleanPhoneNumber(phone) {
    if (!phone) return "";

    // Convert to string if it's not already
    const phoneStr = String(phone);

    // Remove all non-numeric characters
    let cleaned = phoneStr.replace(/\D/g, "");

    // Make sure we have at least 10 digits for a valid phone number
    if (cleaned.length >= 10) {
        // For consistency, always use 10 digit format without + sign
        // If there's a country code, keep just the last 10 digits
        cleaned = cleaned.slice(-10);
    }

    return cleaned;
}

// Map the Referral status to MVIP status naming
function mapStatus(referralStatus) {
    if (!referralStatus) return "";

    const statusMap = {
        New: "New",
        "We Spoke": "Spoke",
        "We Made An Offer": "Offer",
        "We Met / House Hunted": "Met",
        "We're Under Contract": "Contract",
        Closed: "Close",
    };

    return statusMap[referralStatus] || referralStatus;
}

// Function to blend data from multiple sources
function blendData(leadsData, referralsData, soldData) {
    log('Blending data from multiple sources');
    
    // Get broker name from the input field before processing
    const brokerName = document.getElementById('clientBrokerInput').value.trim();
    
    // Map to track unique leads by name
    const uniqueLeads = new Map();
    
    // Step 1: Process ALL leads from leads_data (primary source)
    log('Processing leads data...', `${leadsData.length} rows`);
    leadsData.forEach(lead => {
        // Skip records with no client name
        if (!lead["Client Name"]) return;
        
        const clientName = (lead["Client Name"] || "").trim();
        const nameKey = clientName.toLowerCase();
        
        // Get price range
        const priceSource = lead["List Price"] || lead["Budget"] || "";
        const priceRange = normalizePriceRange(priceSource);
        
        // Create lead record
        const leadRecord = {
            "Client Name": clientName,
            "Client Phone": cleanPhoneNumber(lead["Client Phone"]),
            "Client Email": lead["Client Email"] || "",
            "First Delivery Time": lead["First Delivery Time"] || "",
            "Property Inquiry Zip": lead["Property Inquiry Zip"] || lead["Zip code"] || "",
            "Client Price Range": priceRange,
            "Delivery Type": lead["Delivery Type"] || "",
            "Agent": lead["Agent"] || "",
            "Transaction": lead["Transaction"] || "",
            "Status": lead["Status"] || "",
            "Market": lead["Market"] || "",
            "Lead Zone": lead["Lead Zone"] === 0 ? "0" : lead["Lead Zone"] || "",
            "Source": "Market VIP",
            "Market Type": "Market VIP",
            // Empty purchase fields to be filled later if available
            "purchased sale date": "",
            "purchased address": "",
            "purchased value": "",
            "purchased buyer broker": "",
            // Track where record came from for logging
            "_source": "leads_data"
        };
        
        // Add to unique leads map
        uniqueLeads.set(nameKey, leadRecord);
    });
    
    // Step 2: Process referrals data
    log('Processing referrals data...', `${referralsData.length} rows`);
    
    // Track OpCity leads and Market VIP leads with closed status separately
    const opcityLeads = [];
    const closedMarketVIPLeads = [];
    
    referralsData.forEach(referral => {
        if (!referral["Client Name"]) return;
        
        const clientName = (referral["Client Name"] || "").trim();
        const nameKey = clientName.toLowerCase();
        const source = referral["Lead Source"] || "";
        const status = (referral["Transaction Status"] || "").toLowerCase();
        const isClosed = status === "closed";
        
        // Special handling for Market VIP leads that are closed
        if (source === "Market VIP" && isClosed) {
            closedMarketVIPLeads.push({
                nameKey,
                referral
            });
            return;
        }
        
        // Add OpCity leads to a separate array to process after
        if (source === "Opcity") {
            opcityLeads.push({
                nameKey,
                referral,
                isClosed
            });
            return;
        }
        
        // Update status of existing Market VIP leads (that aren't closed)
        if (source === "Market VIP" && uniqueLeads.has(nameKey)) {
            const existingLead = uniqueLeads.get(nameKey);
            const mappedStatus = mapStatus(referral["Transaction Status"] || "");
            
            // Update status if we have one from referrals
            if (mappedStatus) {
                existingLead["Status"] = mappedStatus;
            }
            
            // Update agent if it's not set
            if (!existingLead["Agent"] && referral["Agent Name"]) {
                existingLead["Agent"] = referral["Agent Name"];
            }
        }
    });
    
    // Step 3: Process closed Market VIP leads from referrals
    log('Processing', closedMarketVIPLeads.length, 'closed Market VIP leads');
    
    closedMarketVIPLeads.forEach(({ nameKey, referral }) => {
        if (uniqueLeads.has(nameKey)) {
            // Update existing lead with closing info
            const existingLead = uniqueLeads.get(nameKey);
            
            // Always update status to Close
            existingLead["Status"] = "Close";
            
            // Update with Transaction Close Date and Amount
            existingLead["purchased sale date"] = referral["Transaction Close Date"] || "";
            existingLead["purchased address"] = referral["Transaction Address"] || "";
            existingLead["purchased value"] = referral["Transaction Close Amount"] || "";
            
            // Set broker to the client broker name for closed Market VIP leads
            existingLead["purchased buyer broker"] = brokerName || "Rock Realty";
        }
    });
    
    // Step 4: Process OpCity leads (these are always added if they don't exist)
    log('Processing', opcityLeads.length, 'OpCity leads');
    
    opcityLeads.forEach(({ nameKey, referral, isClosed }) => {
        // If already in map, update status only
        if (uniqueLeads.has(nameKey)) {
            const existingLead = uniqueLeads.get(nameKey);
            
            // If the OpCity lead is closed, that takes priority
            if (isClosed) {
                existingLead["Status"] = "Close";
                existingLead["purchased sale date"] = referral["Transaction Close Date"] || "";
                existingLead["purchased address"] = referral["Transaction Address"] || "";
                existingLead["purchased value"] = referral["Transaction Close Amount"] || "";
                existingLead["purchased buyer broker"] = "OpCity";
            } else {
                // Otherwise just update status if needed
                const mappedStatus = mapStatus(referral["Transaction Status"] || "");
                if (mappedStatus) {
                    existingLead["Status"] = mappedStatus;
                }
            }
        } else {
            // Create new lead record for OpCity
            const leadRecord = {
                "Client Name": referral["Client Name"].trim(),
                "Client Phone": cleanPhoneNumber(referral["Client Phone"]),
                "Client Email": referral["Client Email"] || "",
                "First Delivery Time": referral["Date Referred"] || "",
                "Property Inquiry Zip": referral["Client Primary Zip Code"] || "",
                "Client Price Range": referral["Client Price Range"] || "Unknown",
                "Delivery Type": "Live transfer",
                "Agent": referral["Agent Name"] || "",
                "Transaction": referral["Client Category"] || "",
                "Status": isClosed ? "Close" : mapStatus(referral["Transaction Status"] || ""),
                "Market": referral["Client Market"] ? referral["Client Market"].split(',')[0] : "",
                "Lead Zone": "",
                "Source": "OpCity",
                "Market Type": "OpCity",
                "_source": "referrals_data"
            };
            
            // Add purchase info if it's closed
            if (isClosed) {
                leadRecord["purchased sale date"] = referral["Transaction Close Date"] || "";
                leadRecord["purchased address"] = referral["Transaction Address"] || "";
                leadRecord["purchased value"] = referral["Transaction Close Amount"] || "";
                leadRecord["purchased buyer broker"] = "OpCity";
            } else {
                leadRecord["purchased sale date"] = "";
                leadRecord["purchased address"] = "";
                leadRecord["purchased value"] = "";
                leadRecord["purchased buyer broker"] = "";
            }
            
            // Add to map
            uniqueLeads.set(nameKey, leadRecord);
        }
    });
    
    // Step 5: Match with sold data
    log('Matching with sold data...', `${soldData.length} rows`);
    let soldMatchCount = 0;
    
    soldData.forEach(soldRecord => {
        const soldLeadName = soldRecord["Lead"] || "";
        if (!soldLeadName) return;
        
        const nameKey = soldLeadName.toLowerCase().trim();
        if (uniqueLeads.has(nameKey)) {
            const existingLead = uniqueLeads.get(nameKey);
            
            // Only update purchase data if not already set (prioritize referrals' close date)
            if (!existingLead["purchased sale date"]) {
                existingLead["purchased sale date"] = soldRecord["purchased sale date"] || "";
                existingLead["purchased address"] = soldRecord["purchased address"] || "";
                existingLead["purchased value"] = soldRecord["purchased value"] || "";
                existingLead["purchased buyer broker"] = soldRecord["purchased buyer broker"] || "";
                
                soldMatchCount++;
            }
        }
    });
    
    // Convert map to array
    const mergedData = Array.from(uniqueLeads.values());
    
    // Clean up tracking fields
    mergedData.forEach(lead => {
        delete lead._source;
    });
    
    log('Data blending complete', {
        total_leads: mergedData.length,
        market_vip_leads: mergedData.filter(l => l.Source === "Market VIP").length,
        opcity_leads: mergedData.filter(l => l.Source === "OpCity").length,
        closed_leads: mergedData.filter(l => l.Status === "Close").length,
        with_purchase_data: mergedData.filter(l => l["purchased sale date"]).length,
        sold_matches: soldMatchCount
    });
    
    return mergedData;
}

// Handle Process Data button click
document.getElementById('processDataBtn').addEventListener('click', function() {
    const leadsFile = document.getElementById('leadsInput').files[0];
    const referralsFile = document.getElementById('referralsInput').files[0];
    const soldDataFile = document.getElementById('soldDataInput').files[0];
    
    if (!leadsFile) {
        document.getElementById('error').textContent = 'Please select a leads data file.';
        document.getElementById('error').style.display = 'block';
        return;
    }
    
    // Show loading indicator
    document.getElementById('loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>Processing data files...</div>
    `;
    document.getElementById('loading').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('debugInfo').innerHTML = '';
    
    // Read all files
    const leadsPromise = readFileAsCSV(leadsFile);
    const referralsPromise = referralsFile ? readFileAsCSV(referralsFile) : Promise.resolve([]);
    const soldDataPromise = soldDataFile ? readFileAsCSV(soldDataFile) : Promise.resolve([]);
    
    Promise.all([leadsPromise, referralsPromise, soldDataPromise])
        .then(([leadsData, referralsData, soldData]) => {
            log('Files loaded', {
                leads: leadsData.length,
                referrals: referralsData.length,
                soldData: soldData.length
            });
            
            try {
                // Blend data from all sources
                const blendedData = blendData(leadsData, referralsData, soldData);
                
                // Store raw data
                rawData = blendedData;
                filteredData = blendedData;
                
                // Initialize filters
                initializeFilters(blendedData);
                
                // Copy the broker name to the filter field
                const clientBrokerName = document.getElementById('clientBrokerInput').value.trim();
                document.getElementById('brokerNameInput').value = clientBrokerName;
                
                // Update dashboard
                updateDashboard();
                
                // Show dashboard
                document.getElementById('dashboard').style.display = 'block';
                document.getElementById('loading').style.display = 'none';
                
                // Add a button to download the blended data
                const downloadBtn = document.createElement('button');
                downloadBtn.id = 'downloadBlendedData';
                downloadBtn.className = 'download-btn';
                downloadBtn.innerHTML = '<i class="download-icon"></i> Download Blended Data';
                downloadBtn.addEventListener('click', function() {
                    downloadBlendedData(rawData);
                });
                
                // Insert below the filter section
                const filterSection = document.querySelector('.filters');
                filterSection.parentNode.insertBefore(downloadBtn, filterSection.nextSibling);
                
                log('Dashboard initialized successfully');
            } catch (err) {
                log('Error processing data', err);
                document.getElementById('error').textContent = `Error: ${err.message}`;
                document.getElementById('error').style.display = 'block';
                document.getElementById('loading').style.display = 'none';
            }
        })
        .catch(err => {
            log('Error reading files', err);
            document.getElementById('error').textContent = `Error reading files: ${err.message}`;
            document.getElementById('error').style.display = 'block';
            document.getElementById('loading').style.display = 'none';
        });
});

// Function to read and parse a file as CSV
function readFileAsCSV(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve([]);
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(event) {
            try {
                Papa.parse(event.target.result, {
                    header: true,
                    skipEmptyLines: true,
                    dynamicTyping: true,
                    complete: function(results) {
                        resolve(results.data);
                    },
                    error: function(error) {
                        reject(error);
                    }
                });
            } catch (err) {
                reject(err);
            }
        };
        
        reader.onerror = function(err) {
            reject(err);
        };
        
        reader.readAsText(file);
    });
}

// Function to download the blended data as CSV
function downloadBlendedData(data) {
    log('Preparing blended data download');
    
    try {
        // Define the important columns in order
        const columns = [
            'Client Name', 'Client Phone', 'Client Email', 'First Delivery Time', 
            'Property Inquiry Zip', 'Client Price Range', 'Delivery Type', 
            'Agent', 'Transaction', 'Status', 'Market', 'Lead Zone', 'Source',
            'Market Type', 'purchased sale date', 'purchased address', 
            'purchased value', 'purchased buyer broker'
        ];
        
        // Use PapaParse to create CSV
        const csv = Papa.unparse({
            fields: columns,
            data: data
        });
        
        // Create a blob and download link
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `blended_data_${timestamp}.csv`;
        
        // Create download link and trigger click
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        log('Blended data download complete', { rows: data.length, filename });
    } catch (err) {
        log('Error generating CSV download', err);
        alert('There was an error generating the CSV file. See console for details.');
    }
}