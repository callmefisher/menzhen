package service

import (
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	ws "github.com/callmefisher/menzhen/server/ws"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// sameDay returns true if a and b fall on the same calendar date (local time).
func sameDay(a, b time.Time) bool {
	a, b = a.Local(), b.Local()
	y1, m1, d1 := a.Date()
	y2, m2, d2 := b.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}

var (
	ErrBillingNotFound      = errors.New("billing not found")
	ErrStockAlreadyDeducted = errors.New("stock already deducted")
	ErrInsufficientStock    = errors.New("insufficient stock")
)

// BillingService handles billing business logic.
type BillingService struct {
	DB *gorm.DB
}

// NewBillingService creates a new BillingService.
func NewBillingService(db *gorm.DB) *BillingService {
	return &BillingService{DB: db}
}

// BillingDetailItem represents a single drug line in the billing detail.
type BillingDetailItem struct {
	HerbName      string  `json:"herb_name"`
	Category      string  `json:"category"`
	Dosage        string  `json:"dosage"`
	DosageVal     float64 `json:"dosage_val"`
	Unit          string  `json:"unit"`
	Doses         int     `json:"doses"`
	UnitPrice     float64 `json:"unit_price"`
	ItemCost      float64 `json:"item_cost"`
	InStock       bool    `json:"in_stock"`
	StockQuantity float64 `json:"stock_quantity"`
	ShelfNo       string  `json:"shelf_no"`
}

// BillingDetail is the full billing detail response.
type BillingDetail struct {
	PrescriptionID  uint64              `json:"prescription_id"`
	RecordID        uint64              `json:"record_id"`
	FormulaName     string              `json:"formula_name"`
	TotalDoses      int                 `json:"total_doses"`
	Items           []BillingDetailItem `json:"items"`
	DrugCostTotal   float64             `json:"drug_cost_total"`
	ConsultationFee float64             `json:"consultation_fee"`
	TotalAmount     float64             `json:"total_amount"`
	ActualPaid      float64             `json:"actual_paid"`
	StockDeducted   bool                `json:"stock_deducted"`
	BillingID       uint64              `json:"billing_id,omitempty"`
	CreatedBy       uint64              `json:"created_by,omitempty"`
}

// GetBillingDetail loads a prescription's items, matches inventory prices, and computes billing detail.
func (s *BillingService) GetBillingDetail(tenantID, prescriptionID uint64) (*BillingDetail, error) {
	var prescription model.Prescription
	if err := s.DB.Preload("Items").Where("tenant_id = ?", tenantID).First(&prescription, prescriptionID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrescriptionNotFound
		}
		return nil, err
	}

	// Load only inventory drugs matching prescription items (not full table).
	herbNames := make([]string, 0, len(prescription.Items))
	for _, pi := range prescription.Items {
		herbNames = append(herbNames, pi.HerbName)
	}
	var drugs []model.InventoryDrug
	if len(herbNames) > 0 {
		if err := s.DB.Where("tenant_id = ? AND name IN ?", tenantID, herbNames).Find(&drugs).Error; err != nil {
			return nil, err
		}
	}
	drugMap := make(map[string]*model.InventoryDrug)
	for i := range drugs {
		drugMap[drugs[i].Name] = &drugs[i]
	}

	// Build detail items.
	var items []BillingDetailItem
	var drugCostTotal float64
	for _, pi := range prescription.Items {
		dosageVal := parseDosageValue(pi.Dosage)
		category := pi.Category
		if category == "" {
			category = "herb"
		}
		unit := "克"
		if category == "patent" {
			unit = "盒"
		}

		// Herbs use total_doses; patents are per-item (no dose multiplier).
		doses := prescription.TotalDoses
		if category == "patent" {
			doses = 1
		}

		item := BillingDetailItem{
			HerbName:  pi.HerbName,
			Category:  category,
			Dosage:    pi.Dosage,
			DosageVal: dosageVal,
			Unit:      unit,
			Doses:     doses,
			InStock:   false,
		}

		if drug, ok := drugMap[pi.HerbName]; ok {
			item.InStock = true
			item.StockQuantity = drug.Stock
			item.ShelfNo = drug.ShelfNo
			if category == "herb" {
				// Inventory stores herb price as 元/500克, convert to 元/克.
				item.UnitPrice = drug.SellingPrice / 500
				item.ItemCost = dosageVal * item.UnitPrice * float64(doses)
			} else {
				// Patent medicine: price is 元/盒, no dose multiplier.
				item.UnitPrice = drug.SellingPrice
				item.ItemCost = dosageVal * drug.SellingPrice
			}
		}

		drugCostTotal += item.ItemCost
		items = append(items, item)
	}

	// Check if there's an existing billing record.
	var billing model.Billing
	consultationFee := float64(100)
	var actualPaid float64
	var stockDeducted bool
	var billingID uint64
	var createdBy uint64
	if err := s.DB.Where("prescription_id = ? AND tenant_id = ?", prescriptionID, tenantID).First(&billing).Error; err == nil {
		consultationFee = billing.ConsultationFee
		actualPaid = billing.ActualPaid
		stockDeducted = billing.StockDeducted
		billingID = billing.ID
		createdBy = billing.CreatedBy
	}

	totalAmount := drugCostTotal + consultationFee

	return &BillingDetail{
		PrescriptionID:  prescriptionID,
		RecordID:        prescription.RecordID,
		FormulaName:     prescription.FormulaName,
		TotalDoses:      prescription.TotalDoses,
		Items:           items,
		DrugCostTotal:   drugCostTotal,
		ConsultationFee: consultationFee,
		TotalAmount:     totalAmount,
		ActualPaid:      actualPaid,
		StockDeducted:   stockDeducted,
		BillingID:       billingID,
		CreatedBy:       createdBy,
	}, nil
}

// CreateBillingRequest is the input for creating/updating a billing.
type CreateBillingRequest struct {
	ConsultationFee float64 `json:"consultation_fee"`
	ActualPaid      float64 `json:"actual_paid"`
}

// CreateBilling creates or updates a billing record (without stock deduction).
func (s *BillingService) CreateBilling(tenantID, userID, prescriptionID uint64, req *CreateBillingRequest) (*model.Billing, error) {
	// Verify prescription belongs to tenant.
	var prescription model.Prescription
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&prescription, prescriptionID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrescriptionNotFound
		}
		return nil, err
	}

	// Compute drug cost from billing detail.
	detail, err := s.GetBillingDetail(tenantID, prescriptionID)
	drugCostTotal := float64(0)
	if err == nil {
		drugCostTotal = detail.DrugCostTotal
	}
	totalAmount := drugCostTotal + req.ConsultationFee

	var billing model.Billing
	err = s.DB.Where("prescription_id = ? AND tenant_id = ?", prescriptionID, tenantID).First(&billing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Create new billing.
		billing = model.Billing{
			PrescriptionID:  prescriptionID,
			RecordID:        prescription.RecordID,
			TenantID:        tenantID,
			ConsultationFee: req.ConsultationFee,
			DrugCostTotal:   drugCostTotal,
			TotalAmount:     totalAmount,
			ActualPaid:      req.ActualPaid,
			CreatedBy:       userID,
		}
		if err := s.DB.Create(&billing).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		// Update existing billing.
		billing.ConsultationFee = req.ConsultationFee
		billing.DrugCostTotal = drugCostTotal
		billing.TotalAmount = totalAmount
		billing.ActualPaid = req.ActualPaid
		if err := s.DB.Save(&billing).Error; err != nil {
			return nil, err
		}
	}

	// 刷新收费日期的收入统计 + 就诊日的记录/患者统计
	statsSvc := NewStatisticsService(s.DB)
	_ = statsSvc.RefreshDailyStats(tenantID, billing.CreatedAt)
	var record model.MedicalRecord
	if err := s.DB.First(&record, billing.RecordID).Error; err == nil {
		if !sameDay(billing.CreatedAt, record.VisitDate) {
			_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
		}
		if err := statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, billing.CreatedAt); err != nil {
			log.Printf("RefreshDailyStaffStats failed for tenant=%d user=%d: %v", tenantID, record.CreatedBy, err)
		}
	}

	return &billing, nil
}


// DeductStockAndBill creates/updates billing and deducts stock in a single transaction.
func (s *BillingService) DeductStockAndBill(tenantID, userID, prescriptionID uint64, req *CreateBillingRequest) (*model.Billing, error) {
	var result *model.Billing

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		// Load prescription with items.
		var prescription model.Prescription
		if err := tx.Preload("Items").Where("tenant_id = ?", tenantID).First(&prescription, prescriptionID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPrescriptionNotFound
			}
			return err
		}

		// Check existing billing for stock_deducted flag.
		var billing model.Billing
		err := tx.Where("prescription_id = ? AND tenant_id = ?", prescriptionID, tenantID).First(&billing).Error
		if err == nil && billing.StockDeducted {
			return ErrStockAlreadyDeducted
		}

		// Deduct stock for each item and build drug map for cost calculation.
		drugMap := make(map[string]*model.InventoryDrug)
		for _, pi := range prescription.Items {
			dosageVal := parseDosageValue(pi.Dosage)
			if dosageVal <= 0 {
				continue
			}
			// Herbs: multiply by total_doses; patents: just the quantity.
			category := pi.Category
			if category == "" {
				category = "herb"
			}
			deductQty := dosageVal
			if category == "herb" {
				deductQty = dosageVal * float64(prescription.TotalDoses)
			}

			// Lock the drug row for update.
			var drug model.InventoryDrug
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("tenant_id = ? AND name = ?", tenantID, pi.HerbName).
				First(&drug).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					// Drug not in inventory — skip (price=0, no stock to deduct).
					continue
				}
				return err
			}

			if drug.Stock < deductQty {
				return fmt.Errorf("%w: %s 库存 %.2f 不足, 需要 %.2f", ErrInsufficientStock, pi.HerbName, drug.Stock, deductQty)
			}

			if err := tx.Model(&drug).Update("stock", gorm.Expr("stock - ?", deductQty)).Error; err != nil {
				return err
			}
			drugMap[drug.Name] = &drug
		}

		// Compute drug cost from locked drug data (no extra query needed).
		var drugCostTotal float64
		for _, pi := range prescription.Items {
			dosageVal := parseDosageValue(pi.Dosage)
			category := pi.Category
			if category == "" {
				category = "herb"
			}
			if drug, ok := drugMap[pi.HerbName]; ok {
				if category == "herb" {
					drugCostTotal += dosageVal * (drug.SellingPrice / 500) * float64(prescription.TotalDoses)
				} else {
					drugCostTotal += dosageVal * drug.SellingPrice
				}
			}
		}
		totalAmount := drugCostTotal + req.ConsultationFee

		// Create or update billing with stock_deducted = true.
		if errors.Is(err, gorm.ErrRecordNotFound) {
			billing = model.Billing{
				PrescriptionID:  prescriptionID,
				RecordID:        prescription.RecordID,
				TenantID:        tenantID,
				ConsultationFee: req.ConsultationFee,
				DrugCostTotal:   drugCostTotal,
				TotalAmount:     totalAmount,
				ActualPaid:      req.ActualPaid,
				StockDeducted:   true,
				CreatedBy:       userID,
			}
			if err := tx.Create(&billing).Error; err != nil {
				return err
			}
		} else {
			billing.ConsultationFee = req.ConsultationFee
			billing.DrugCostTotal = drugCostTotal
			billing.TotalAmount = totalAmount
			billing.ActualPaid = req.ActualPaid
			billing.StockDeducted = true
			if err := tx.Save(&billing).Error; err != nil {
				return err
			}
		}

		result = &billing
		return nil
	})

	if err != nil {
		return nil, err
	}

	statsSvc := NewStatisticsService(s.DB)
	_ = statsSvc.RefreshDailyStats(tenantID, result.CreatedAt)
	var record model.MedicalRecord
	if err := s.DB.First(&record, result.RecordID).Error; err == nil {
		if !sameDay(result.CreatedAt, record.VisitDate) {
			_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
		}
		if err := statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, result.CreatedAt); err != nil {
			log.Printf("RefreshDailyStaffStats failed for tenant=%d user=%d: %v", tenantID, record.CreatedBy, err)
		}
	}

	// After the transaction succeeds and stats are refreshed, create notification asynchronously
	go func() {
		pnSvc := NewPrescriptionNotificationService(s.DB)
		// Get patient name
		var patientName string
		if err := s.DB.Table("patients").Select("name").
			Joins("JOIN medical_records ON medical_records.patient_id = patients.id").
			Where("medical_records.id = ? AND medical_records.tenant_id = ?", result.RecordID, tenantID).Scan(&patientName).Error; err != nil {
			log.Printf("failed to query patient name for notification (record_id=%d): %v", result.RecordID, err)
		}
		// Get doctor name
		var doctorName string
		if err := s.DB.Table("users").Select("real_name").Where("id = ? AND tenant_id = ?", result.CreatedBy, tenantID).Scan(&doctorName).Error; err != nil {
			log.Printf("failed to query doctor name for notification (user_id=%d): %v", result.CreatedBy, err)
		}
		// Count herbs and patents
		var herbCount, patentCount int64
		s.DB.Model(&model.PrescriptionItem{}).Where("prescription_id = ? AND category != 'patent'", prescriptionID).Count(&herbCount)
		s.DB.Model(&model.PrescriptionItem{}).Where("prescription_id = ? AND category = 'patent'", prescriptionID).Count(&patentCount)

		// Load prescription for formula details
		var prescription model.Prescription
		s.DB.Where("tenant_id = ?", tenantID).First(&prescription, prescriptionID)

		n := &model.PrescriptionNotification{
			TenantID:       tenantID,
			PrescriptionID: prescriptionID,
			RecordID:       result.RecordID,
			PatientName:    patientName,
			DoctorName:     doctorName,
			FormulaName:    prescription.FormulaName,
			TotalDoses:     prescription.TotalDoses,
			HerbCount:      int(herbCount),
			PatentCount:    int(patentCount),
			Notes:          prescription.Notes,
			Status:         "pending",
			CreatedBy:      result.CreatedBy,
		}
		if err := pnSvc.Create(n); err != nil {
			log.Printf("failed to create prescription notification: %v", err)
		} else {
			ws.DefaultHub.Broadcast(tenantID, ws.Message{Type: "rx_notify", Payload: n})
		}
	}()

	return result, nil
}

// GetRecordBillingDetail returns a billing detail for a record with no prescription (consultation fee only).
func (s *BillingService) GetRecordBillingDetail(tenantID, recordID uint64) (*BillingDetail, error) {
	// Verify record belongs to tenant.
	var record model.MedicalRecord
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&record, recordID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("record not found")
		}
		return nil, err
	}

	consultationFee := float64(100)
	var actualPaid float64
	var billingID uint64
	var createdBy uint64

	var billing model.Billing
	if err := s.DB.Where("record_id = ? AND tenant_id = ? AND prescription_id = 0", recordID, tenantID).First(&billing).Error; err == nil {
		consultationFee = billing.ConsultationFee
		actualPaid = billing.ActualPaid
		billingID = billing.ID
		createdBy = billing.CreatedBy
	}

	return &BillingDetail{
		PrescriptionID:  0,
		RecordID:        recordID,
		Items:           []BillingDetailItem{},
		DrugCostTotal:   0,
		ConsultationFee: consultationFee,
		TotalAmount:     consultationFee,
		ActualPaid:      actualPaid,
		BillingID:       billingID,
		CreatedBy:       createdBy,
	}, nil
}

// CreateRecordBilling creates or updates a record-level billing (consultation fee only, no prescription).
func (s *BillingService) CreateRecordBilling(tenantID, userID, recordID uint64, req *CreateBillingRequest) (*model.Billing, error) {
	// Verify record belongs to tenant.
	var record model.MedicalRecord
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&record, recordID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("record not found")
		}
		return nil, err
	}

	var billing model.Billing
	err := s.DB.Where("record_id = ? AND tenant_id = ? AND prescription_id = 0", recordID, tenantID).First(&billing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		billing = model.Billing{
			PrescriptionID:  0,
			RecordID:        recordID,
			TenantID:        tenantID,
			ConsultationFee: req.ConsultationFee,
			DrugCostTotal:   0,
			TotalAmount:     req.ConsultationFee,
			ActualPaid:      req.ActualPaid,
			CreatedBy:       userID,
		}
		if err := s.DB.Create(&billing).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		billing.ConsultationFee = req.ConsultationFee
		billing.DrugCostTotal = 0
		billing.TotalAmount = req.ConsultationFee
		billing.ActualPaid = req.ActualPaid
		if err := s.DB.Save(&billing).Error; err != nil {
			return nil, err
		}
	}

	// 刷新收费日期的收入统计 + 就诊日的记录/患者统计
	statsSvc := NewStatisticsService(s.DB)
	_ = statsSvc.RefreshDailyStats(tenantID, billing.CreatedAt)
	if !sameDay(billing.CreatedAt, record.VisitDate) {
		_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
	}
	if err := statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, billing.CreatedAt); err != nil {
		log.Printf("RefreshDailyStaffStats failed for tenant=%d user=%d: %v", tenantID, record.CreatedBy, err)
	}

	return &billing, nil
}

// ListBillingsByRecord returns all billings for a given record.
func (s *BillingService) ListBillingsByRecord(tenantID, recordID uint64) ([]model.Billing, error) {
	var billings []model.Billing
	if err := s.DB.Where("tenant_id = ? AND record_id = ?", tenantID, recordID).
		Order("created_at ASC").Find(&billings).Error; err != nil {
		return nil, err
	}
	return billings, nil
}

// parseDosageValue extracts the numeric value from a dosage string like "9g", "15", "30克", "2盒".
func parseDosageValue(dosage string) float64 {
	dosage = strings.TrimSpace(dosage)
	if dosage == "" {
		return 0
	}

	// Try to match a number (int or float) at the beginning.
	re := regexp.MustCompile(`^(\d+(?:\.\d+)?)`)
	matches := re.FindStringSubmatch(dosage)
	if len(matches) < 2 {
		return 0
	}

	val, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0
	}
	return val
}
