# Enhanced Monitoring and Alerting Configuration

# Notification channels
resource "google_monitoring_notification_channel" "email" {
  count        = length(var.alert_email_addresses)
  display_name = "Email - ${var.alert_email_addresses[count.index]}"
  type         = "email"
  
  labels = {
    email_address = var.alert_email_addresses[count.index]
  }
}

resource "google_monitoring_notification_channel" "slack" {
  count        = var.slack_webhook_url != "" ? 1 : 0
  display_name = "Slack - Deployments"
  type         = "slack"
  
  labels = {
    channel_name = var.slack_channel
    url          = var.slack_webhook_url
  }
}

resource "google_monitoring_notification_channel" "pagerduty" {
  count        = var.pagerduty_key != "" ? 1 : 0
  display_name = "PagerDuty - Critical Alerts"
  type         = "pagerduty"
  
  labels = {
    service_key = var.pagerduty_key
  }
}

# Custom dashboard
resource "google_monitoring_dashboard" "travel_planner_dashboard" {
  dashboard_json = jsonencode({
    displayName = "Travel Planner - Production Dashboard"
    mosaicLayout = {
      tiles = [
        {
          width  = 6
          height = 4
          widget = {
            title = "Request Rate"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_RATE"
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Requests/sec"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          width  = 6
          height = 4
          xPos   = 6
          widget = {
            title = "Response Latency (95th percentile)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_DELTA"
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
            }
          }
        },
        {
          width  = 6
          height = 4
          yPos   = 4
          widget = {
            title = "Error Rate"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\" AND metric.labels.response_code_class=\"4xx\" OR metric.labels.response_code_class=\"5xx\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_RATE"
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
            }
          }
        },
        {
          width  = 6
          height = 4
          xPos   = 6
          yPos   = 4
          widget = {
            title = "Active Instances"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
            }
          }
        }
      ]
    }
  })
}

# Alert policies
resource "google_monitoring_alert_policy" "high_error_rate" {
  display_name = "Travel Planner - High Error Rate"
  combiner     = "OR"
  enabled      = true
  
  conditions {
    display_name = "Error rate > 5%"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 0.05
      
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      
      trigger {
        count   = 1
        percent = 0
      }
    }
  }
  
  notification_channels = concat(
    google_monitoring_notification_channel.email[*].id,
    var.slack_webhook_url != "" ? google_monitoring_notification_channel.slack[*].id : [],
    var.pagerduty_key != "" ? google_monitoring_notification_channel.pagerduty[*].id : []
  )
  
  alert_strategy {
    auto_close           = "1800s"
    notification_rate_limit {
      period = "300s"
    }
  }
  
  documentation {
    content = <<-EOT
      High error rate detected in Travel Planner backend service.
      
      Investigation steps:
      1. Check application logs in Cloud Logging
      2. Review recent deployments
      3. Check external API dependencies
      4. Verify database connectivity
      
      Runbook: https://docs.travel-planner.com/runbooks/high-error-rate
    EOT
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "high_latency" {
  display_name = "Travel Planner - High Response Latency"
  combiner     = "OR"
  enabled      = true
  
  conditions {
    display_name = "95th percentile latency > 2 seconds"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 2000
      
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_PERCENTILE_95"
      }
    }
  }
  
  notification_channels = google_monitoring_notification_channel.email[*].id
  
  alert_strategy {
    auto_close = "1800s"
  }
  
  documentation {
    content = <<-EOT
      High response latency detected in Travel Planner.
      
      Common causes:
      - Database query performance issues
      - External API timeouts
      - High CPU/memory usage
      - Network connectivity issues
      
      Runbook: https://docs.travel-planner.com/runbooks/high-latency
    EOT
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "service_down" {
  display_name = "Travel Planner - Service Down"
  combiner     = "OR"
  enabled      = true
  
  conditions {
    display_name = "Service is not responding"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      duration        = "180s"
      comparison      = "COMPARISON_EQUAL"
      threshold_value = 0
      
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  
  notification_channels = concat(
    google_monitoring_notification_channel.email[*].id,
    var.pagerduty_key != "" ? google_monitoring_notification_channel.pagerduty[*].id : []
  )
  
  alert_strategy {
    auto_close = "300s"
  }
  
  documentation {
    content = <<-EOT
      Travel Planner service is completely down - no requests being processed.
      
      CRITICAL ISSUE - Immediate action required:
      1. Check service status in Cloud Run console
      2. Review recent deployments for rollback
      3. Check service logs for crash/startup issues
      4. Verify infrastructure resources
      
      Escalation: If not resolved in 15 minutes, page on-call engineer
      Runbook: https://docs.travel-planner.com/runbooks/service-down
    EOT
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "high_memory_usage" {
  display_name = "Travel Planner - High Memory Usage"
  combiner     = "OR"
  enabled      = true
  
  conditions {
    display_name = "Memory usage > 80%"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      duration        = "600s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 0.8
      
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MEAN"
      }
    }
  }
  
  notification_channels = google_monitoring_notification_channel.email[*].id
  
  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_alert_policy" "database_connection_issues" {
  display_name = "Travel Planner - Database Connection Issues"
  combiner     = "OR"
  enabled      = true
  
  conditions {
    display_name = "High database error rate"
    
    condition_threshold {
      filter          = "resource.type=\"gce_instance\" AND metric.type=\"logging.googleapis.com/user/database_errors\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 10
      
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  
  notification_channels = google_monitoring_notification_channel.email[*].id
  
  documentation {
    content = <<-EOT
      Database connectivity issues detected.
      
      Steps to investigate:
      1. Check Firestore status in GCP console
      2. Verify service account permissions
      3. Check network connectivity
      4. Review database query patterns for locks/timeouts
      
      Runbook: https://docs.travel-planner.com/runbooks/database-issues
    EOT
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "external_api_failures" {
  display_name = "Travel Planner - External API Failures"
  combiner     = "OR"
  enabled      = true
  
  conditions {
    display_name = "High external API failure rate"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.labels.api_name=(\"anthropic\" OR \"amadeus\")"
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 0.1
      
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
      }
    }
  }
  
  notification_channels = google_monitoring_notification_channel.email[*].id
  
  documentation {
    content = <<-EOT
      External API failure rate is elevated.
      
      Common issues:
      - API key expiration or rate limiting
      - Network connectivity issues
      - External service outages
      
      Check status pages:
      - Anthropic: https://status.anthropic.com
      - Amadeus: https://developers.amadeus.com/support
      
      Runbook: https://docs.travel-planner.com/runbooks/external-api-failures
    EOT
    mime_type = "text/markdown"
  }
}

# Uptime checks
resource "google_monitoring_uptime_check_config" "frontend_uptime" {
  display_name = "Travel Planner Frontend Uptime"
  timeout      = "10s"
  period       = "60s"
  
  http_check {
    path           = "/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }
  
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = replace(google_cloud_run_service.frontend.status[0].url, "https://", "")
    }
  }
  
  content_matchers {
    content = "healthy"
    matcher = "CONTAINS_STRING"
  }
  
  checker_type = "STATIC_IP_CHECKERS"
}

resource "google_monitoring_uptime_check_config" "backend_uptime" {
  display_name = "Travel Planner Backend API Uptime"
  timeout      = "10s"
  period       = "60s"
  
  http_check {
    path           = "/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
    
    headers = {
      "User-Agent" = "Google-Cloud-Monitoring-UptimeCheck"
    }
  }
  
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = replace(google_cloud_run_service.backend.status[0].url, "https://", "")
    }
  }
  
  content_matchers {
    content = "healthy"
    matcher = "CONTAINS_STRING"
  }
  
  checker_type = "STATIC_IP_CHECKERS"
}

# Log-based metrics
resource "google_logging_metric" "error_rate_metric" {
  name   = "travel_planner_error_rate"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\" AND (severity=\"ERROR\" OR httpRequest.status>=400)"
  
  metric_descriptor {
    metric_kind = "GAUGE"
    value_type  = "DOUBLE"
    unit        = "1"
    display_name = "Travel Planner Error Rate"
  }
  
  value_extractor = "EXTRACT(httpRequest.status)"
  
  label_extractors = {
    "status_code" = "EXTRACT(httpRequest.status)"
    "method"      = "EXTRACT(httpRequest.requestMethod)"
  }
}

resource "google_logging_metric" "database_errors" {
  name   = "travel_planner_database_errors"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\" AND (textPayload:\"database\" OR textPayload:\"firestore\") AND severity=\"ERROR\""
  
  metric_descriptor {
    metric_kind = "GAUGE"
    value_type  = "INT64"
    unit        = "1"
    display_name = "Travel Planner Database Errors"
  }
}

# SLO (Service Level Objectives)
resource "google_monitoring_slo" "availability_slo" {
  service      = google_monitoring_service.travel_planner_service.service_id
  display_name = "Travel Planner Availability SLO"
  
  request_based_sli {
    good_total_ratio {
      good_service_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\" AND httpRequest.status<500"
      total_service_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
    }
  }
  
  goal                = 0.995  # 99.5% availability
  rolling_period_days = 30
}

resource "google_monitoring_slo" "latency_slo" {
  service      = google_monitoring_service.travel_planner_service.service_id
  display_name = "Travel Planner Latency SLO"
  
  request_based_sli {
    distribution_cut {
      distribution_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      
      range {
        max = 2000  # 2 seconds
      }
    }
  }
  
  goal                = 0.95   # 95% of requests under 2s
  rolling_period_days = 30
}

# Custom service for SLO
resource "google_monitoring_service" "travel_planner_service" {
  service_id   = "travel-planner"
  display_name = "Travel Planner Service"
  
  cloud_run {
    service_name = google_cloud_run_service.backend.name
    location     = var.region
  }
}

# Export important metrics to external systems
resource "google_monitoring_group" "travel_planner_services" {
  display_name = "Travel Planner Services"
  filter       = "resource.label.\"service_name\"=monitoring.regex(\"travel-planner.*\")"
}

# Variables for monitoring configuration
variable "alert_email_addresses" {
  description = "List of email addresses to receive alerts"
  type        = list(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for notifications"
  type        = string
  default     = ""
  sensitive   = true
}

variable "slack_channel" {
  description = "Slack channel for notifications"
  type        = string
  default     = "#deployments"
}

variable "pagerduty_key" {
  description = "PagerDuty service key for critical alerts"
  type        = string
  default     = ""
  sensitive   = true
}