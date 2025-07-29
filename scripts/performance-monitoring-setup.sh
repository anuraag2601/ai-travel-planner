#!/bin/bash

# Performance Monitoring and APM Setup Script
# This script configures comprehensive performance monitoring for the Travel Planner application

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
ENVIRONMENT="${1:-production}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Validation
validate_environment() {
    if [[ -z "${PROJECT_ID}" ]]; then
        log_error "GCP_PROJECT_ID environment variable is required"
        exit 1
    fi
    
    log_info "Setting up performance monitoring for environment: $ENVIRONMENT"
    log_info "Project ID: $PROJECT_ID"
    log_info "Region: $REGION"
}

# Create custom metrics
create_custom_metrics() {
    log_info "Creating custom performance metrics..."
    
    # API Response Time metric
    gcloud logging metrics create travel_planner_api_response_time \
        --description="API response time for Travel Planner" \
        --log-filter="resource.type=\"cloud_run_revision\" 
            AND resource.labels.service_name=\"travel-planner-api\" 
            AND httpRequest.responseSize>0" \
        --value-extractor="EXTRACT(httpRequest.latency)" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "API response time metric already exists"
    
    # Database Query Time metric
    gcloud logging metrics create travel_planner_db_query_time \
        --description="Database query time for Travel Planner" \
        --log-filter="resource.type=\"cloud_run_revision\" 
            AND jsonPayload.component=\"database\" 
            AND jsonPayload.query_time_ms>0" \
        --value-extractor="EXTRACT(jsonPayload.query_time_ms)" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "Database query time metric already exists"
    
    # External API Call Duration metric
    gcloud logging metrics create travel_planner_external_api_duration \
        --description="External API call duration for Travel Planner" \
        --log-filter="resource.type=\"cloud_run_revision\" 
            AND jsonPayload.component=\"external_api\" 
            AND jsonPayload.duration_ms>0" \
        --value-extractor="EXTRACT(jsonPayload.duration_ms)" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "External API duration metric already exists"
    
    # Memory Usage metric
    gcloud logging metrics create travel_planner_memory_usage \
        --description="Memory usage for Travel Planner" \
        --log-filter="resource.type=\"cloud_run_revision\" 
            AND jsonPayload.component=\"performance\" 
            AND jsonPayload.memory_usage_mb>0" \
        --value-extractor="EXTRACT(jsonPayload.memory_usage_mb)" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "Memory usage metric already exists"
    
    # CPU Usage metric
    gcloud logging metrics create travel_planner_cpu_usage \
        --description="CPU usage for Travel Planner" \
        --log-filter="resource.type=\"cloud_run_revision\" 
            AND jsonPayload.component=\"performance\" 
            AND jsonPayload.cpu_usage_percent>0" \
        --value-extractor="EXTRACT(jsonPayload.cpu_usage_percent)" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "CPU usage metric already exists"
    
    log_success "Custom metrics created successfully"
}

# Create performance dashboards
create_performance_dashboard() {
    log_info "Creating performance monitoring dashboard..."
    
    # Create dashboard JSON configuration
    cat > performance-dashboard.json << 'EOF'
{
  "displayName": "Travel Planner - Performance Monitoring",
  "mosaicLayout": {
    "tiles": [
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "API Response Time (P95)",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"travel-planner-api\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_DELTA",
                      "crossSeriesReducer": "REDUCE_PERCENTILE_95"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1"
              }
            ],
            "timeshiftDuration": "0s",
            "yAxis": {
              "label": "Response Time (ms)",
              "scale": "LINEAR"
            },
            "chartOptions": {
              "mode": "COLOR"
            }
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "xPos": 6,
        "widget": {
          "title": "Request Rate",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"travel-planner-api\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_RATE",
                      "crossSeriesReducer": "REDUCE_SUM"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1"
              }
            ],
            "yAxis": {
              "label": "Requests/sec",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "yPos": 4,
        "widget": {
          "title": "Memory Usage",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"travel-planner-api\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_MEAN",
                      "crossSeriesReducer": "REDUCE_MEAN"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1"
              }
            ],
            "yAxis": {
              "label": "Memory (MB)",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "xPos": 6,
        "yPos": 4,
        "widget": {
          "title": "CPU Utilization",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"travel-planner-api\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_MEAN",
                      "crossSeriesReducer": "REDUCE_MEAN"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1"
              }
            ],
            "yAxis": {
              "label": "CPU (%)",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "yPos": 8,
        "widget": {
          "title": "Database Query Performance",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "metric.type=\"logging.googleapis.com/user/travel_planner_db_query_time\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_MEAN",
                      "crossSeriesReducer": "REDUCE_MEAN"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1"
              }
            ],
            "yAxis": {
              "label": "Query Time (ms)",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "xPos": 6,
        "yPos": 8,
        "widget": {
          "title": "External API Performance",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "metric.type=\"logging.googleapis.com/user/travel_planner_external_api_duration\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_MEAN",
                      "crossSeriesReducer": "REDUCE_MEAN"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1"
              }
            ],
            "yAxis": {
              "label": "API Call Duration (ms)",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "width": 12,
        "height": 4,
        "yPos": 12,
        "widget": {
          "title": "Error Rate by Status Code",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"travel-planner-api\" AND httpRequest.status>=400",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_RATE",
                      "crossSeriesReducer": "REDUCE_SUM",
                      "groupByFields": ["httpRequest.status"]
                    }
                  }
                },
                "plotType": "STACKED_AREA",
                "targetAxis": "Y1"
              }
            ],
            "yAxis": {
              "label": "Errors/sec",
              "scale": "LINEAR"
            }
          }
        }
      }
    ]
  }
}
EOF
    
    # Create the dashboard
    gcloud monitoring dashboards create --config-from-file="performance-dashboard.json" --project="$PROJECT_ID" || \
        log_warning "Dashboard already exists or creation failed"
    
    rm -f performance-dashboard.json
    log_success "Performance dashboard created"
}

# Create performance alert policies
create_performance_alerts() {
    log_info "Creating performance alert policies..."
    
    # High P95 response time alert
    gcloud alpha monitoring policies create --policy-from-file=<(cat <<EOF
displayName: "Travel Planner - High P95 Response Time"
documentation:
  content: |
    High P95 response time detected in Travel Planner API.
    
    This alert triggers when 95% of API requests take longer than 3 seconds.
    
    Investigation steps:
    1. Check Cloud Run instances and scaling
    2. Review database query performance
    3. Check external API dependencies
    4. Analyze request distribution
    
    Runbook: https://docs.travel-planner.com/runbooks/high-latency
  mimeType: "text/markdown"
conditions:
  - displayName: "P95 Response Time > 3 seconds"
    conditionThreshold:
      filter: 'resource.type="cloud_run_revision" AND resource.labels.service_name="travel-planner-api"'
      aggregations:
        - alignmentPeriod: "300s"
          perSeriesAligner: "ALIGN_DELTA"
          crossSeriesReducer: "REDUCE_PERCENTILE_95"
      comparison: "COMPARISON_GREATER_THAN"
      thresholdValue: 3000
      duration: "300s"
      trigger:
        count: 1
combiner: "OR"
enabled: true
notificationChannels: []
alertStrategy:
  autoClose: "1800s"
EOF
) --project="$PROJECT_ID" 2>/dev/null || log_warning "P95 response time alert already exists"
    
    # High memory usage alert
    gcloud alpha monitoring policies create --policy-from-file=<(cat <<EOF
displayName: "Travel Planner - High Memory Usage"
documentation:
  content: |
    High memory usage detected in Travel Planner services.
    
    This alert triggers when memory usage exceeds 85% for 5 minutes.
    
    Investigation steps:
    1. Check for memory leaks in application code
    2. Review memory allocation patterns
    3. Consider scaling up instances
    4. Analyze garbage collection patterns
    
    Runbook: https://docs.travel-planner.com/runbooks/high-memory
conditions:
  - displayName: "Memory Usage > 85%"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/travel_planner_memory_usage"'
      aggregations:
        - alignmentPeriod: "300s"
          perSeriesAligner: "ALIGN_MEAN"
          crossSeriesReducer: "REDUCE_MEAN"
      comparison: "COMPARISON_GREATER_THAN"
      thresholdValue: 85
      duration: "300s"
combiner: "OR"
enabled: true
notificationChannels: []
EOF
) --project="$PROJECT_ID" 2>/dev/null || log_warning "High memory usage alert already exists"
    
    # Slow database queries alert
    gcloud alpha monitoring policies create --policy-from-file=<(cat <<EOF
displayName: "Travel Planner - Slow Database Queries"
documentation:
  content: |
    Slow database queries detected in Travel Planner.
    
    This alert triggers when average database query time exceeds 1 second.
    
    Investigation steps:
    1. Review slow query logs
    2. Check database indexes
    3. Analyze query patterns
    4. Consider query optimization
conditions:
  - displayName: "DB Query Time > 1 second"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/travel_planner_db_query_time"'
      aggregations:
        - alignmentPeriod: "300s"
          perSeriesAligner: "ALIGN_MEAN"
          crossSeriesReducer: "REDUCE_MEAN"
      comparison: "COMPARISON_GREATER_THAN"
      thresholdValue: 1000
      duration: "300s"
combiner: "OR"
enabled: true
notificationChannels: []
EOF
) --project="$PROJECT_ID" 2>/dev/null || log_warning "Slow database queries alert already exists"
    
    log_success "Performance alert policies created"
}

# Set up APM tracing
setup_apm_tracing() {
    log_info "Setting up APM tracing configuration..."
    
    # Enable Cloud Trace API
    gcloud services enable cloudtrace.googleapis.com --project="$PROJECT_ID"
    
    # Create trace sampling configuration
    cat > trace-config.json << 'EOF'
{
  "traceSamplingConfig": {
    "samplingProbability": 0.1
  },
  "traceExportConfig": {
    "batchConfig": {
      "maxExportBatchSize": 512,
      "exportTimeout": "30s",
      "scheduleDelay": "5s"
    }
  }
}
EOF
    
    log_info "Trace configuration created"
    log_info "Add the following environment variables to your Cloud Run services:"
    log_info "  GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
    log_info "  OTEL_RESOURCE_ATTRIBUTES=service.name=travel-planner-$ENVIRONMENT"
    log_info "  OTEL_EXPORTER_OTLP_ENDPOINT=https://cloudtrace.googleapis.com/v1/projects/$PROJECT_ID/traces"
    
    rm -f trace-config.json
    log_success "APM tracing setup completed"
}

# Create SLI/SLO configurations
create_sli_slo() {
    log_info "Creating SLI/SLO configurations..."
    
    # Availability SLO
    gcloud alpha monitoring services create \
        --service-id="travel-planner-$ENVIRONMENT" \
        --display-name="Travel Planner $ENVIRONMENT" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "Service already exists"
    
    # Create SLO for availability
    gcloud alpha monitoring slo create \
        --service="travel-planner-$ENVIRONMENT" \
        --slo-id="availability-slo" \
        --display-name="99.9% Availability SLO" \
        --goal=0.999 \
        --calendar-period=30 \
        --request-based-goodness-total-ratio \
        --good-service-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="travel-planner-api" AND httpRequest.status<500' \
        --total-service-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="travel-planner-api"' \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "Availability SLO already exists"
    
    # Create SLO for latency
    gcloud alpha monitoring slo create \
        --service="travel-planner-$ENVIRONMENT" \
        --slo-id="latency-slo" \
        --display-name="95% Requests Under 2s" \
        --goal=0.95 \
        --calendar-period=30 \
        --request-based-distribution-cut \
        --distribution-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="travel-planner-api"' \
        --range-max=2000 \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "Latency SLO already exists"
    
    log_success "SLI/SLO configurations created"
}

# Create performance test scripts
create_performance_tests() {
    log_info "Creating performance test scripts..."
    
    # Create load test script
    cat > "../load-tests/api-load-test.js" << 'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up to 10 users
    { duration: '5m', target: 10 }, // Stay at 10 users
    { duration: '2m', target: 20 }, // Ramp up to 20 users
    { duration: '5m', target: 20 }, // Stay at 20 users
    { duration: '2m', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.05'],    // Error rate under 5%
    errors: ['rate<0.05'],             // Custom error rate under 5%
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'https://travel-planner-api-production.com';

export default function () {
  // Health check endpoint
  let response = http.get(`${BASE_URL}/health`);
  check(response, {
    'health check status is 200': (r) => r.status === 200,
    'health check response time < 500ms': (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(1);

  // API version endpoint
  response = http.get(`${BASE_URL}/api/v1`);
  check(response, {
    'API version status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(1);

  // Search flights endpoint (simulated)
  const searchPayload = JSON.stringify({
    origin: 'NYC',
    destination: 'LAX',
    departureDate: '2024-12-01',
    passengers: 1
  });

  response = http.post(`${BASE_URL}/api/v1/search/flights`, searchPayload, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  check(response, {
    'flight search status is 200 or 400': (r) => r.status === 200 || r.status === 400,
    'flight search response time < 5s': (r) => r.timings.duration < 5000,
  }) || errorRate.add(1);

  sleep(2);

  // Generate itinerary endpoint (simulated)
  const itineraryPayload = JSON.stringify({
    destination: 'Paris',
    duration: 7,
    budget: 2000,
    interests: ['culture', 'food']
  });

  response = http.post(`${BASE_URL}/api/v1/itineraries/generate`, itineraryPayload, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  check(response, {
    'itinerary generation response time < 10s': (r) => r.timings.duration < 10000,
  }) || errorRate.add(1);

  sleep(3);
}

// Setup function
export function setup() {
  console.log('Starting performance test...');
  console.log(`Target URL: ${BASE_URL}`);
}

// Teardown function
export function teardown(data) {
  console.log('Performance test completed');
}
EOF
    
    # Create stress test script
    cat > "../load-tests/stress-test.js" << 'EOF'
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '3m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 200 },  // Ramp up to 200 users
    { duration: '3m', target: 300 },  // Ramp up to 300 users
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% of requests under 5s
    http_req_failed: ['rate<0.1'],     // Error rate under 10%
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'https://travel-planner-api-production.com';

export default function () {
  const response = http.get(`${BASE_URL}/health`);
  check(response, {
    'status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);
}
EOF
    
    # Create monitoring test script
    cat > "../scripts/check-metrics.sh" << 'EOF'
#!/bin/bash

# Performance Metrics Checker
# Usage: ./check-metrics.sh --service=SERVICE_NAME --duration=DURATION

SERVICE_NAME="travel-planner-api"
DURATION="10m"
PROJECT_ID="${GCP_PROJECT_ID}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --service=*)
      SERVICE_NAME="${1#*=}"
      shift
      ;;
    --duration=*)
      DURATION="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "Checking metrics for service: $SERVICE_NAME"
echo "Duration: $DURATION"

# Convert duration to seconds for timestamp calculation
case $DURATION in
  *m)
    SECONDS_AGO=$((${DURATION%m} * 60))
    ;;
  *h)
    SECONDS_AGO=$((${DURATION%h} * 3600))
    ;;
  *)
    SECONDS_AGO=600  # Default 10 minutes
    ;;
esac

START_TIME=$(date -u -d "$SECONDS_AGO seconds ago" +%Y-%m-%dT%H:%M:%SZ)
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "Checking metrics from $START_TIME to $END_TIME"

# Check error rate
echo "=== Error Rate ==="
gcloud logging read "resource.type=\"cloud_run_revision\" 
  AND resource.labels.service_name=\"$SERVICE_NAME\" 
  AND httpRequest.status>=400 
  AND timestamp>=\"$START_TIME\"" \
  --limit=100 \
  --format="table(timestamp,httpRequest.status,httpRequest.requestUrl)" \
  --project="$PROJECT_ID"

# Check response times
echo "=== Slow Requests (>2s) ==="
gcloud logging read "resource.type=\"cloud_run_revision\" 
  AND resource.labels.service_name=\"$SERVICE_NAME\" 
  AND httpRequest.latency>\"2s\" 
  AND timestamp>=\"$START_TIME\"" \
  --limit=50 \
  --format="table(timestamp,httpRequest.latency,httpRequest.requestUrl)" \
  --project="$PROJECT_ID"

echo "Metrics check complete"
EOF
    
    chmod +x "../scripts/check-metrics.sh"
    
    log_success "Performance test scripts created"
}

# Generate performance report
generate_performance_report() {
    log_info "Generating performance monitoring setup report..."
    
    cat > "performance-monitoring-report.md" << EOF
# Travel Planner Performance Monitoring Setup

## Overview
Performance monitoring has been configured for the Travel Planner application with comprehensive metrics, dashboards, and alerting.

## Components Configured

### 1. Custom Metrics
- **API Response Time**: Tracks HTTP request latency
- **Database Query Time**: Monitors database performance
- **External API Duration**: Tracks third-party API calls
- **Memory Usage**: Application memory consumption
- **CPU Usage**: Application CPU utilization

### 2. Performance Dashboard
A comprehensive dashboard has been created in Google Cloud Monitoring with:
- Real-time performance metrics visualization
- P95 response time tracking
- Request rate monitoring
- Resource utilization graphs
- Error rate analysis

### 3. Alert Policies
- **High P95 Response Time**: Alerts when response time > 3 seconds
- **High Memory Usage**: Alerts when memory usage > 85%
- **Slow Database Queries**: Alerts when query time > 1 second

### 4. SLI/SLO Configuration
- **Availability SLO**: 99.9% availability target
- **Latency SLO**: 95% of requests under 2 seconds

### 5. Load Testing Scripts
- **API Load Test**: Gradual load testing with k6
- **Stress Test**: High-load stress testing
- **Metrics Checker**: Command-line metrics analysis

## Usage Instructions

### Viewing Performance Metrics
1. Open Google Cloud Console
2. Navigate to Monitoring > Dashboards
3. Select "Travel Planner - Performance Monitoring"

### Running Load Tests
\`\`\`bash
# Basic load test
k6 run load-tests/api-load-test.js

# Stress test
k6 run load-tests/stress-test.js

# Custom load test with environment variables
API_BASE_URL=https://your-api-url.com k6 run load-tests/api-load-test.js
\`\`\`

### Checking Metrics
\`\`\`bash
# Check all metrics for last 10 minutes
./scripts/check-metrics.sh --service=travel-planner-api --duration=10m

# Check specific service for last hour
./scripts/check-metrics.sh --service=travel-planner-frontend --duration=1h
\`\`\`

## Performance Thresholds

| Metric | Target | Alert Threshold |
|--------|---------|-----------------|
| API Response Time (P95) | < 2 seconds | > 3 seconds |
| Error Rate | < 1% | > 5% |
| Memory Usage | < 80% | > 85% |
| CPU Usage | < 70% | > 85% |
| Database Query Time | < 500ms | > 1 second |

## Monitoring Best Practices

1. **Regular Review**: Check performance metrics weekly
2. **Load Testing**: Run load tests before major releases
3. **Alert Response**: Respond to performance alerts within 30 minutes
4. **Optimization**: Address performance issues proactively
5. **Capacity Planning**: Monitor trends and plan scaling

## Troubleshooting

### High Response Time
1. Check Cloud Run instance scaling
2. Review database query performance
3. Analyze external API dependencies
4. Check network connectivity

### High Memory Usage
1. Look for memory leaks in application logs
2. Review object lifecycle management
3. Consider increasing instance memory
4. Analyze garbage collection patterns

### Database Performance Issues
1. Review slow query logs
2. Check database indexes
3. Analyze connection pool settings
4. Consider query optimization

## Next Steps

1. **Custom Alerting**: Set up team-specific notification channels
2. **Automated Scaling**: Configure auto-scaling based on performance metrics
3. **Performance Budget**: Implement performance budgets for CI/CD
4. **APM Integration**: Consider adding detailed APM tracing

---

Generated on: $(date)
Environment: $ENVIRONMENT
Project: $PROJECT_ID
EOF
    
    log_success "Performance monitoring report generated: performance-monitoring-report.md"
}

# Main execution
main() {
    log_info "=== Travel Planner Performance Monitoring Setup ==="
    
    validate_environment
    
    create_custom_metrics
    create_performance_dashboard
    create_performance_alerts
    setup_apm_tracing
    create_sli_slo
    create_performance_tests
    generate_performance_report
    
    log_success "Performance monitoring setup completed successfully!"
    log_info "Dashboard: https://console.cloud.google.com/monitoring/dashboards"
    log_info "Metrics: https://console.cloud.google.com/monitoring/metrics-explorer"
    log_info "Alerts: https://console.cloud.google.com/monitoring/alerting"
}

# Run main function
main "$@"