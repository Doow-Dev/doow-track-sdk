package doow

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// FileOfflineStore persists batches to disk when network is unavailable
type FileOfflineStore struct {
	dir string
	mu  sync.Mutex
}

// NewFileOfflineStore creates a file-based offline store
func NewFileOfflineStore(dir string) (*FileOfflineStore, error) {
	if dir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("get home dir: %w", err)
		}
		dir = filepath.Join(homeDir, ".doow", "offline")
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create offline dir: %w", err)
	}

	return &FileOfflineStore{dir: dir}, nil
}

func (s *FileOfflineStore) filename(batchID string) string {
	return filepath.Join(s.dir, batchID+".json")
}

// Push saves a batch to disk
func (s *FileOfflineStore) Push(batch SerializedBatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("marshal batch: %w", err)
	}

	if err := os.WriteFile(s.filename(batch.BatchID), data, 0644); err != nil {
		return fmt.Errorf("write batch file: %w", err)
	}

	return nil
}

// Shift removes and returns the oldest batch
func (s *FileOfflineStore) Shift() (*SerializedBatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("read offline dir: %w", err)
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			files = append(files, e.Name())
		}
	}

	if len(files) == 0 {
		return nil, nil
	}

	// Sort by filename (which includes timestamp-like batch IDs)
	sort.Strings(files)
	oldest := files[0]

	path := filepath.Join(s.dir, oldest)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read batch file: %w", err)
	}

	var batch SerializedBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		os.Remove(path) // Remove corrupted file
		return nil, fmt.Errorf("unmarshal batch: %w", err)
	}

	if err := os.Remove(path); err != nil {
		return nil, fmt.Errorf("remove batch file: %w", err)
	}

	return &batch, nil
}

// Length returns the number of pending batches
func (s *FileOfflineStore) Length() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0, fmt.Errorf("read offline dir: %w", err)
	}

	count := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			count++
		}
	}

	return count, nil
}
