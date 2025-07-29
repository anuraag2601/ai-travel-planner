# Networking Infrastructure for Travel Planner

# VPC Network
resource "google_compute_network" "vpc_network" {
  count                   = var.enable_vpc_connector ? 1 : 0
  name                    = "${var.app_name}-${var.environment}-vpc"
  auto_create_subnetworks = false
  mtu                     = 1460
  
  description = "VPC network for ${var.app_name} ${var.environment} environment"
  
  delete_default_routes_on_create = false
  
  labels = merge(var.labels, var.additional_labels, {
    environment = var.environment
    component   = "networking"
  })
}

# Subnet
resource "google_compute_subnetwork" "vpc_subnet" {
  count         = var.enable_vpc_connector ? 1 : 0
  name          = "${var.app_name}-${var.environment}-subnet"
  ip_cidr_range = var.subnet_cidr
  region        = var.region
  network       = google_compute_network.vpc_network[0].id
  
  description = "Subnet for ${var.app_name} ${var.environment} environment"
  
  # Enable private Google access
  private_ip_google_access = true
  
  # Secondary IP ranges for GKE (if needed in the future)
  dynamic "secondary_ip_range" {
    for_each = var.environment == "production" ? [1] : []
    content {
      range_name    = "gke-pods"
      ip_cidr_range = "10.1.0.0/16"
    }
  }
  
  dynamic "secondary_ip_range" {
    for_each = var.environment == "production" ? [1] : []
    content {
      range_name    = "gke-services"
      ip_cidr_range = "10.2.0.0/16"
    }
  }
  
  # Log configuration
  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# VPC Connector for Cloud Run
resource "google_vpc_access_connector" "connector" {
  count         = var.enable_vpc_connector ? 1 : 0
  name          = "${var.app_name}-${var.environment}-vpc-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc_network[0].name
  
  min_throughput = 200
  max_throughput = var.environment == "production" ? 1000 : 300
  
  depends_on = [google_project_service.apis]
}

# Cloud Router for NAT Gateway
resource "google_compute_router" "router" {
  count   = var.enable_nat_gateway && var.enable_vpc_connector ? 1 : 0
  name    = "${var.app_name}-${var.environment}-router"
  region  = var.region
  network = google_compute_network.vpc_network[0].id
  
  description = "Router for ${var.app_name} ${var.environment} NAT gateway"
  
  bgp {
    asn = 64514
  }
}

# NAT Gateway
resource "google_compute_router_nat" "nat" {
  count                              = var.enable_nat_gateway && var.enable_vpc_connector ? 1 : 0
  name                               = "${var.app_name}-${var.environment}-nat"
  router                             = google_compute_router.router[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
  
  min_ports_per_vm = 64
  
  depends_on = [google_compute_subnetwork.vpc_subnet]
}

# Firewall Rules
resource "google_compute_firewall" "allow_internal" {
  count   = var.enable_vpc_connector ? 1 : 0
  name    = "${var.app_name}-${var.environment}-allow-internal"
  network = google_compute_network.vpc_network[0].name
  
  description = "Allow internal communication within VPC"
  
  allow {
    protocol = "tcp"
    ports    = ["22", "80", "443", "8080", "8443"]
  }
  
  allow {
    protocol = "udp"
    ports    = ["53"]
  }
  
  allow {
    protocol = "icmp"
  }
  
  source_ranges = [var.subnet_cidr]
  target_tags   = ["${var.app_name}-${var.environment}"]
  
  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "allow_health_checks" {
  count   = var.enable_vpc_connector ? 1 : 0
  name    = "${var.app_name}-${var.environment}-allow-health-checks"
  network = google_compute_network.vpc_network[0].name
  
  description = "Allow Google Cloud health checks"
  
  allow {
    protocol = "tcp"
    ports    = ["80", "443", "8080"]
  }
  
  source_ranges = [
    "130.211.0.0/22",
    "35.191.0.0/16"
  ]
  
  target_tags = ["${var.app_name}-${var.environment}"]
}

resource "google_compute_firewall" "deny_all" {
  count   = var.enable_vpc_connector ? 1 : 0
  name    = "${var.app_name}-${var.environment}-deny-all"
  network = google_compute_network.vpc_network[0].name
  
  description = "Deny all other traffic"
  priority    = 65534
  
  deny {
    protocol = "all"
  }
  
  source_ranges = ["0.0.0.0/0"]
  
  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

# Global Load Balancer Components
resource "google_compute_global_address" "default" {
  count        = var.enable_load_balancer ? 1 : 0
  name         = "${var.app_name}-${var.environment}-global-ip"
  address_type = "EXTERNAL"
  description  = "Global external IP for ${var.app_name} ${var.environment} load balancer"
}

# SSL Certificate
resource "google_compute_managed_ssl_certificate" "default" {
  count = var.enable_load_balancer && length(var.ssl_certificate_domains) > 0 ? 1 : 0
  name  = "${var.app_name}-${var.environment}-ssl-cert"
  
  managed {
    domains = var.ssl_certificate_domains
  }
  
  lifecycle {
    create_before_destroy = true
  }
}

# Backend service for Cloud Run
resource "google_compute_backend_service" "frontend" {
  count                           = var.enable_load_balancer ? 1 : 0
  name                            = "${var.app_name}-${var.environment}-frontend-backend"
  description                     = "Backend service for ${var.app_name} frontend"
  port_name                       = "http"
  protocol                        = "HTTP"
  timeout_sec                     = 30
  connection_draining_timeout_sec = 300
  
  backend {
    group = google_compute_region_network_endpoint_group.frontend[0].id
  }
  
  health_checks = [google_compute_health_check.frontend[0].id]
  
  log_config {
    enable      = true
    sample_rate = 1.0
  }
  
  # CDN configuration
  enable_cdn = var.enable_cdn
  
  dynamic "cdn_policy" {
    for_each = var.enable_cdn ? [1] : []
    content {
      cache_mode                   = var.cdn_cache_mode
      default_ttl                  = var.cdn_default_ttl
      max_ttl                      = var.cdn_default_ttl * 4
      client_ttl                   = var.cdn_default_ttl
      negative_caching             = true
      serve_while_stale            = 86400
      
      cache_key_policy {
        include_host           = true
        include_protocol       = true
        include_query_string   = false
        query_string_blacklist = ["utm_source", "utm_medium", "utm_campaign"]
      }
      
      negative_caching_policy {
        code = 404
        ttl  = 120
      }
      
      negative_caching_policy {
        code = 410
        ttl  = 120
      }
    }
  }
  
  depends_on = [google_project_service.apis]
}

resource "google_compute_backend_service" "backend" {
  count                           = var.enable_load_balancer ? 1 : 0
  name                            = "${var.app_name}-${var.environment}-backend-backend"
  description                     = "Backend service for ${var.app_name} backend API"
  port_name                       = "http"
  protocol                        = "HTTP"
  timeout_sec                     = 30
  connection_draining_timeout_sec = 300
  
  backend {
    group = google_compute_region_network_endpoint_group.backend[0].id
  }
  
  health_checks = [google_compute_health_check.backend[0].id]
  
  log_config {
    enable      = true
    sample_rate = 1.0
  }
  
  depends_on = [google_project_service.apis]
}

# Network Endpoint Groups for Cloud Run services
resource "google_compute_region_network_endpoint_group" "frontend" {
  count                 = var.enable_load_balancer ? 1 : 0
  name                  = "${var.app_name}-${var.environment}-frontend-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  
  cloud_run {
    service = google_cloud_run_service.frontend.name
  }
  
  depends_on = [google_cloud_run_service.frontend]
}

resource "google_compute_region_network_endpoint_group" "backend" {
  count                 = var.enable_load_balancer ? 1 : 0
  name                  = "${var.app_name}-${var.environment}-backend-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  
  cloud_run {
    service = google_cloud_run_service.backend.name
  }
  
  depends_on = [google_cloud_run_service.backend]
}

# Health checks
resource "google_compute_health_check" "frontend" {
  count               = var.enable_load_balancer ? 1 : 0
  name                = "${var.app_name}-${var.environment}-frontend-health"
  description         = "Health check for frontend service"
  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3
  
  http_health_check {
    port_specification = "USE_SERVING_PORT"
    host               = ""
    request_path       = "/health"
  }
  
  log_config {
    enable = true
  }
}

resource "google_compute_health_check" "backend" {
  count               = var.enable_load_balancer ? 1 : 0
  name                = "${var.app_name}-${var.environment}-backend-health"
  description         = "Health check for backend API service"
  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3
  
  http_health_check {
    port_specification = "USE_SERVING_PORT"
    host               = ""
    request_path       = "/health"
  }
  
  log_config {
    enable = true
  }
}

# URL Map
resource "google_compute_url_map" "default" {
  count           = var.enable_load_balancer ? 1 : 0
  name            = "${var.app_name}-${var.environment}-url-map"
  description     = "URL map for ${var.app_name} ${var.environment} load balancer"
  default_service = google_compute_backend_service.frontend[0].id
  
  # API routes
  path_matcher {
    name            = "api-routes"
    default_service = google_compute_backend_service.backend[0].id
    
    path_rule {
      paths   = ["/api/*", "/health", "/ready", "/alive"]
      service = google_compute_backend_service.backend[0].id
    }
  }
  
  # Frontend routes
  path_matcher {
    name            = "frontend-routes"
    default_service = google_compute_backend_service.frontend[0].id
    
    path_rule {
      paths   = ["/*"]
      service = google_compute_backend_service.frontend[0].id
    }
  }
  
  host_rule {
    hosts        = var.ssl_certificate_domains
    path_matcher = "api-routes"
  }
  
  host_rule {
    hosts        = var.ssl_certificate_domains
    path_matcher = "frontend-routes"
  }
}

# HTTPS Proxy
resource "google_compute_target_https_proxy" "default" {
  count            = var.enable_load_balancer && length(var.ssl_certificate_domains) > 0 ? 1 : 0
  name             = "${var.app_name}-${var.environment}-https-proxy"
  description      = "HTTPS proxy for ${var.app_name} ${var.environment}"
  url_map          = google_compute_url_map.default[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.default[0].id]
  
  ssl_policy = google_compute_ssl_policy.modern[0].id
}

# HTTP Proxy (for redirect to HTTPS)
resource "google_compute_target_http_proxy" "default" {
  count       = var.enable_load_balancer ? 1 : 0
  name        = "${var.app_name}-${var.environment}-http-proxy"
  description = "HTTP proxy for ${var.app_name} ${var.environment} (redirect to HTTPS)"
  url_map     = google_compute_url_map.https_redirect[0].id
}

# HTTPS redirect URL map
resource "google_compute_url_map" "https_redirect" {
  count = var.enable_load_balancer ? 1 : 0
  name  = "${var.app_name}-${var.environment}-https-redirect"
  
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

# SSL Policy
resource "google_compute_ssl_policy" "modern" {
  count           = var.enable_load_balancer && length(var.ssl_certificate_domains) > 0 ? 1 : 0
  name            = "${var.app_name}-${var.environment}-ssl-policy"
  description     = "Modern SSL policy for ${var.app_name} ${var.environment}"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

# Forwarding Rules
resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.enable_load_balancer && length(var.ssl_certificate_domains) > 0 ? 1 : 0
  name                  = "${var.app_name}-${var.environment}-https-forwarding-rule"
  description           = "HTTPS forwarding rule for ${var.app_name} ${var.environment}"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "443"
  target                = google_compute_target_https_proxy.default[0].id
  ip_address            = google_compute_global_address.default[0].address
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = var.enable_load_balancer ? 1 : 0
  name                  = "${var.app_name}-${var.environment}-http-forwarding-rule"
  description           = "HTTP forwarding rule for ${var.app_name} ${var.environment}"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "80"
  target                = google_compute_target_http_proxy.default[0].id
  ip_address            = google_compute_global_address.default[0].address
}

# Cloud Armor Security Policy
resource "google_compute_security_policy" "policy" {
  count       = var.enable_cloud_armor ? 1 : 0
  name        = "${var.app_name}-${var.environment}-security-policy"
  description = "Cloud Armor security policy for ${var.app_name} ${var.environment}"
  
  # Rate limiting rule
  rule {
    action   = "rate_based_ban"
    priority = "1000"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Rate limiting rule"
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_requests_per_minute
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
  }
  
  # Geo-based blocking (if needed)
  dynamic "rule" {
    for_each = var.environment == "production" ? [1] : []
    content {
      action   = "deny(403)"
      priority = "2000"
      match {
        expr {
          expression = "origin.region_code == 'CN' || origin.region_code == 'RU'"
        }
      }
      description = "Block traffic from specific regions"
    }
  }
  
  # OWASP Core Rule Set
  rule {
    action   = "deny(403)"
    priority = "3000"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-stable')"
      }
    }
    description = "Block XSS attacks"
  }
  
  rule {
    action   = "deny(403)"
    priority = "3001"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-stable')"
      }
    }
    description = "Block SQL injection attacks"
  }
  
  # Default allow rule
  rule {
    action   = "allow"
    priority = "2147483647"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }
  
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable          = true
      rule_visibility = "STANDARD"
    }
  }
}

# Outputs
output "vpc_network_name" {
  description = "Name of the VPC network"
  value       = var.enable_vpc_connector ? google_compute_network.vpc_network[0].name : null
}

output "vpc_connector_name" {
  description = "Name of the VPC connector"
  value       = var.enable_vpc_connector ? google_vpc_access_connector.connector[0].name : null
}

output "global_ip_address" {
  description = "Global IP address for load balancer"
  value       = var.enable_load_balancer ? google_compute_global_address.default[0].address : null
}

output "ssl_certificate_domains" {
  description = "Domains covered by SSL certificate"
  value       = var.enable_load_balancer && length(var.ssl_certificate_domains) > 0 ? google_compute_managed_ssl_certificate.default[0].managed[0].domains : []
}