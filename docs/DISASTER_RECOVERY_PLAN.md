# Travel Planner - Disaster Recovery Plan

## Overview

This document outlines the comprehensive disaster recovery procedures for the AI Travel Planner application, including automated rollback mechanisms, incident response procedures, and business continuity measures.

## Quick Reference

### Emergency Contacts
- **On-Call Engineer**: Defined in PagerDuty rotation
- **DevOps Team Lead**: alerts@travel-planner.com
- **Security Team**: security@travel-planner.com
- **Business Stakeholders**: management@travel-planner.com

### Critical Service URLs
- **Production Frontend**: https://travel-planner-web-production.com
- **Production Backend**: https://travel-planner-api-production.com
- **Staging Environment**: https://travel-planner-staging.com
- **Monitoring Dashboard**: https://console.cloud.google.com/monitoring/dashboards

### Emergency Procedures
1. **Immediate Response**: Execute automated rollback
2. **Escalation**: Page on-call engineer if not resolved in 15 minutes
3. **Communication**: Update status page and notify stakeholders
4. **Investigation**: Preserve logs and evidence for post-incident analysis

## Disaster Scenarios and Response

### 1. Application Deployment Failure

#### Symptoms
- Health checks failing after deployment
- High error rates (>5%) in monitoring
- Service unavailable responses
- User reports of application issues

#### Automated Response
```bash
# Triggered automatically by monitoring alerts
./scripts/automated-rollback.sh production deployment_failure
```

#### Manual Response Steps
1. **Immediate Action** (0-5 minutes)
   ```bash
   # Check service status
   gcloud run services list --region=us-central1
   
   # Review recent deployments
   gcloud run revisions list --service=travel-planner-api --region=us-central1 --limit=5
   
   # Execute rollback if needed
   ./scripts/automated-rollback.sh production manual
   ```

2. **Verification** (5-10 minutes)
   ```bash
   # Verify service health
   curl -f https://travel-planner-api-production.com/health
   
   # Check error rates
   ./scripts/check-metrics.sh --service=all --duration=10m
   ```

3. **Communication** (10-15 minutes)
   - Update incident status page
   - Notify stakeholders via Slack
   - Create incident ticket

#### Recovery Time Objective (RTO)
- **Target**: 10 minutes
- **Maximum**: 30 minutes

#### Recovery Point Objective (RPO)
- **Target**: 0 (stateless application)
- **Database**: Last backup (15 minutes max)

### 2. Database Corruption or Loss

#### Symptoms
- Database connection errors
- Data inconsistency reports
- Firestore errors in logs
- User data access issues

#### Immediate Response
1. **Stop Application Traffic** (0-2 minutes)
   ```bash
   # Redirect traffic to maintenance page
   gcloud run services update-traffic travel-planner-api \
     --to-tags=maintenance=100 --region=us-central1
   ```

2. **Assess Damage** (2-5 minutes)
   ```bash
   # Check Firestore status
   gcloud firestore operations list
   
   # Verify data integrity
   ./scripts/database-health-check.sh
   ```

3. **Restore from Backup** (5-30 minutes)
   ```bash
   # List available backups
   gsutil ls gs://travel-planner-db-backups/
   
   # Restore latest backup
   ./scripts/restore-database.sh --backup=latest --confirm
   ```

#### Database Backup Strategy
- **Automated backups**: Every 4 hours
- **Retention**: 30 days for daily, 12 months for weekly
- **Location**: Multi-region Cloud Storage
- **Validation**: Daily restore tests in staging environment

### 3. Infrastructure Failure

#### Symptoms
- Complete service unavailability
- GCP region outage
- Network connectivity issues
- Multiple service failures

#### Response Procedures

##### 3.1 Single Region Failure
1. **Failover to Secondary Region** (0-10 minutes)
   ```bash
   # Deploy to backup region
   ./scripts/disaster-failover.sh --target-region=us-east1
   
   # Update DNS routing
   ./scripts/update-dns-failover.sh
   ```

2. **Verify Failover** (10-15 minutes)
   ```bash
   # Test services in new region
   ./scripts/health-check-all.sh --region=us-east1
   ```

##### 3.2 Complete GCP Outage
1. **Activate Multi-Cloud Setup** (0-30 minutes)
   ```bash
   # Deploy to AWS backup infrastructure
   ./scripts/aws-emergency-deploy.sh
   
   # Update external DNS
   ./scripts/dns-emergency-switch.sh --provider=aws
   ```

### 4. Security Incident

#### Symptoms
- Suspicious authentication patterns
- Unauthorized access attempts
- Data breach indicators
- Security tool alerts

#### Response Procedures
1. **Immediate Containment** (0-5 minutes)
   ```bash
   # Enable maintenance mode
   ./scripts/enable-maintenance-mode.sh
   
   # Revoke all active sessions
   ./scripts/revoke-all-sessions.sh
   
   # Block suspicious IPs
   ./scripts/block-ips.sh --file=suspicious-ips.txt
   ```

2. **Investigation** (5-30 minutes)
   ```bash
   # Collect security logs
   ./scripts/collect-security-logs.sh --timerange=24h
   
   # Analyze access patterns
   ./scripts/analyze-access-patterns.sh
   ```

3. **Recovery** (30-60 minutes)
   ```bash
   # Rotate all secrets
   ./scripts/rotate-all-secrets.sh
   
   # Deploy security patches
   ./scripts/emergency-security-deploy.sh
   
   # Restore normal operations
   ./scripts/disable-maintenance-mode.sh
   ```

## Automated Monitoring and Alerting

### Health Check Endpoints
- **Application Health**: `/health`
- **Database Health**: `/health/database`
- **External APIs**: `/health/external`
- **Readiness**: `/ready`
- **Liveness**: `/alive`

### Alert Thresholds
- **Error Rate**: >5% for 5 minutes → Automated rollback
- **Response Time**: >2 seconds 95th percentile for 5 minutes → Alert
- **Service Down**: No requests for 3 minutes → Page immediately
- **Database Errors**: >10 errors/minute → Investigation required

### Monitoring Tools
- **Cloud Monitoring**: Primary alerting and metrics
- **Cloud Logging**: Centralized log aggregation
- **Uptime Checks**: External service monitoring
- **SLI/SLO Monitoring**: Service level tracking

## Communication Plan

### Incident Severity Levels

#### Severity 1 (Critical)
- **Definition**: Complete service outage or security breach
- **Response Time**: 15 minutes
- **Escalation**: Immediate page to on-call
- **Communication**: All stakeholders, public status page

#### Severity 2 (High)
- **Definition**: Degraded service performance
- **Response Time**: 1 hour
- **Escalation**: Slack notification to team
- **Communication**: Internal stakeholders

#### Severity 3 (Medium)
- **Definition**: Minor issues or planned maintenance
- **Response Time**: 4 hours
- **Escalation**: Ticket assignment
- **Communication**: Development team

### Stakeholder Notification Matrix

| Severity | Engineering | Management | Users | Partners |
|----------|-------------|------------|-------|----------|
| Critical | Immediately | 15 minutes | 30 minutes | 1 hour |
| High     | 15 minutes  | 1 hour     | 2 hours    | 4 hours |
| Medium   | 1 hour      | Next day   | If relevant | If relevant |

## Testing and Validation

### Disaster Recovery Drills

#### Monthly Drills
- **Rollback Testing**: Practice deployment rollbacks
- **Database Recovery**: Test backup restore procedures
- **Monitoring Validation**: Verify alert systems

#### Quarterly Drills
- **Full DR Scenario**: Complete infrastructure failover
- **Security Incident**: Tabletop security response exercise
- **Multi-team Coordination**: Cross-functional incident response

#### Annual Drills
- **Regional Failover**: Test multi-region deployment
- **Extended Outage**: 24-hour simulation
- **Compliance Audit**: DR procedure compliance review

### Test Documentation
```bash
# Run comprehensive DR test
./scripts/disaster-recovery-test.sh --scenario=full --duration=1h

# Validate backup integrity
./scripts/validate-backups.sh --all --deep-check

# Test monitoring alerts
./scripts/test-monitoring-alerts.sh --all-severities
```

## Backup and Recovery Procedures

### Application Backups
- **Container Images**: Stored in Artifact Registry with 90-day retention
- **Configuration**: Terraform state and Kubernetes manifests in Git
- **Secrets**: Backed up in Google Secret Manager

### Database Backups
```bash
# Manual backup
gcloud firestore export gs://travel-planner-db-backups/manual-$(date +%Y%m%d_%H%M%S)

# Restore specific backup
gcloud firestore import gs://travel-planner-db-backups/backup-20241201_140000

# List available backups
gsutil ls -l gs://travel-planner-db-backups/
```

### Code and Configuration Backups
- **Primary**: Git repositories (GitHub)
- **Mirror**: GitLab backup repositories
- **Infrastructure**: Terraform state in Cloud Storage with versioning

## Post-Incident Procedures

### Immediate Actions (0-2 hours)
1. **Service Restoration Verification**
   - Confirm all services operational
   - Validate user access and functionality
   - Monitor metrics for stability

2. **Stakeholder Communication**
   - Update status page with resolution
   - Send all-clear notifications
   - Schedule post-incident review meeting

### Follow-up Actions (2-24 hours)
1. **Log Preservation**
   ```bash
   # Archive incident logs
   ./scripts/archive-incident-logs.sh --incident-id=INCIDENT_ID
   
   # Generate incident report
   ./scripts/generate-incident-report.sh --incident-id=INCIDENT_ID
   ```

2. **Metrics Analysis**
   - Extract performance metrics during incident
   - Calculate actual RTO/RPO vs. targets
   - Document any SLA breaches

### Post-Incident Review (24-72 hours)
1. **Conduct Blameless Postmortem**
   - Timeline reconstruction
   - Root cause analysis
   - Contributing factors identification

2. **Action Item Generation**
   - Process improvements
   - Tool enhancements
   - Training requirements
   - Documentation updates

3. **Follow-up Tracking**
   - Assign action item owners
   - Set completion deadlines
   - Schedule progress reviews

## Compliance and Audit

### Documentation Requirements
- **Incident Reports**: All Severity 1 and 2 incidents
- **DR Test Results**: Monthly test outcomes
- **Backup Validation**: Weekly backup integrity checks
- **Compliance Checks**: Quarterly audit preparation

### Audit Trail
```bash
# Generate compliance report
./scripts/generate-compliance-report.sh --period=monthly

# Export audit logs
./scripts/export-audit-logs.sh --format=json --timerange=90d
```

### Regulatory Compliance
- **SOC 2 Type II**: Quarterly compliance validation
- **GDPR**: Data protection impact assessments
- **Industry Standards**: Following cloud security best practices

## Contact Information and Escalation

### Primary Contacts
- **Incident Commander**: Available 24/7 via PagerDuty
- **Technical Lead**: Direct phone and Slack
- **Security Officer**: Email and emergency phone
- **Management**: Business hours contact, emergency escalation

### Escalation Matrix
1. **Level 1**: On-call engineer (0-15 minutes)
2. **Level 2**: Technical lead (15-30 minutes)
3. **Level 3**: Management (30-60 minutes)
4. **Level 4**: Executive team (1+ hours for critical incidents)

### External Contacts
- **GCP Support**: Premium support case escalation
- **External Partners**: API providers, CDN services
- **Legal/Compliance**: For security or data incidents

---

## Appendix: Scripts and Tools

### Essential Scripts Location
- `/scripts/automated-rollback.sh` - Automated rollback execution
- `/scripts/disaster-failover.sh` - Multi-region failover
- `/scripts/health-check-all.sh` - Comprehensive health validation
- `/scripts/restore-database.sh` - Database recovery procedures

### Monitoring Dashboards
- **Operational Overview**: Primary metrics and health status
- **Incident Response**: Real-time incident tracking
- **Security Monitoring**: Security events and threats
- **Business Metrics**: User impact and business KPIs

### Emergency Procedures Quick Card
Keep this information readily accessible for all team members:

```
EMERGENCY HOTLINE: +1-XXX-XXX-XXXX
INCIDENT COMMANDER: Available via PagerDuty
STATUS PAGE: https://status.travel-planner.com
ROLLBACK COMMAND: ./scripts/automated-rollback.sh production emergency
```

This disaster recovery plan should be reviewed quarterly and updated based on lessons learned from incidents and DR tests.