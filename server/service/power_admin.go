package service

import (
	"fmt"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// PowerAdminItem is returned by ListPowerAdmins.
type PowerAdminItem struct {
	UserID    uint64   `json:"user_id"`
	Username  string   `json:"username"`
	RealName  string   `json:"real_name"`
	Status    int8     `json:"status"`
	Groups    []string `json:"groups"`
	CreatedAt string   `json:"created_at"`
}

// PowerAdminService manages powerAdmin authorization.
type PowerAdminService struct {
	db *gorm.DB
}

// NewPowerAdminService creates a new PowerAdminService.
func NewPowerAdminService(db *gorm.DB) *PowerAdminService {
	return &PowerAdminService{db: db}
}

// GetManagedGroups returns all group names a user is authorized to manage.
func (s *PowerAdminService) GetManagedGroups(userID uint64) ([]string, error) {
	var records []model.UserManagedGroup
	if err := s.db.Where("user_id = ?", userID).Find(&records).Error; err != nil {
		return nil, fmt.Errorf("get managed groups: %w", err)
	}
	groups := make([]string, len(records))
	for i, r := range records {
		groups[i] = r.GroupName
	}
	return groups, nil
}

// GetManagedGroupsForUser is an alias used by the auth handler.
// Returns an empty slice (not nil) on any error so JWT always embeds a valid array.
func (s *PowerAdminService) GetManagedGroupsForUser(userID uint64) ([]string, error) {
	groups, err := s.GetManagedGroups(userID)
	if err != nil || groups == nil {
		return []string{}, err
	}
	return groups, nil
}

// AssignGroups replaces the full set of managed groups for a user in a transaction.
// Passing an empty slice removes all groups.
// Also bumps token_version so the user's JWT gets refreshed on the next request.
func (s *PowerAdminService) AssignGroups(userID uint64, groups []string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserManagedGroup{}).Error; err != nil {
			return fmt.Errorf("delete old groups: %w", err)
		}
		for _, g := range groups {
			mg := model.UserManagedGroup{UserID: userID, GroupName: g}
			if err := tx.Create(&mg).Error; err != nil {
				return fmt.Errorf("insert group %q: %w", g, err)
			}
		}
		if err := tx.Model(&model.User{}).Where("id = ?", userID).
			UpdateColumn("token_version", gorm.Expr("token_version + 1")).Error; err != nil {
			return fmt.Errorf("bump token_version: %w", err)
		}
		return nil
	})
}

// ListPowerAdmins returns all users that have at least one managed group.
func (s *PowerAdminService) ListPowerAdmins() ([]PowerAdminItem, error) {
	var records []model.UserManagedGroup
	if err := s.db.Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list managed groups: %w", err)
	}

	groupsByUser := make(map[uint64][]string)
	var userIDs []uint64
	for _, r := range records {
		if _, exists := groupsByUser[r.UserID]; !exists {
			userIDs = append(userIDs, r.UserID)
		}
		groupsByUser[r.UserID] = append(groupsByUser[r.UserID], r.GroupName)
	}

	if len(userIDs) == 0 {
		return []PowerAdminItem{}, nil
	}

	var users []model.User
	if err := s.db.Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}

	items := make([]PowerAdminItem, len(users))
	for i, u := range users {
		items[i] = PowerAdminItem{
			UserID:    u.ID,
			Username:  u.Username,
			RealName:  u.RealName,
			Status:    u.Status,
			Groups:    groupsByUser[u.ID],
			CreatedAt: u.CreatedAt.Format(time.DateTime),
		}
	}
	return items, nil
}

// GroupInfo holds a group name and its tenant count.
type GroupInfo struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// GetAllGroups returns all distinct non-empty group names with tenant counts.
func (s *PowerAdminService) GetAllGroups() ([]GroupInfo, error) {
	type row struct {
		GroupName string
		Count     int
	}
	var rows []row
	if err := s.db.Model(&model.Tenant{}).
		Select("group_name, COUNT(*) as count").
		Where("group_name != ''").
		Group("group_name").
		Order("group_name").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("get all groups: %w", err)
	}
	result := make([]GroupInfo, len(rows))
	for i, r := range rows {
		result[i] = GroupInfo{Name: r.GroupName, Count: r.Count}
	}
	return result, nil
}
