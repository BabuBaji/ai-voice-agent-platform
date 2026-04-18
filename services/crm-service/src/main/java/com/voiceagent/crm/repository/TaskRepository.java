package com.voiceagent.crm.repository;

import com.voiceagent.crm.entity.Task;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface TaskRepository extends JpaRepository<Task, UUID> {

    Page<Task> findByTenantId(UUID tenantId, Pageable pageable);

    Optional<Task> findByIdAndTenantId(UUID id, UUID tenantId);
}
