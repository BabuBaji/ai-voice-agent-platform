package com.voiceagent.crm.repository;

import com.voiceagent.crm.entity.Note;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface NoteRepository extends JpaRepository<Note, UUID> {

    List<Note> findByEntityTypeAndEntityIdAndTenantId(String entityType, UUID entityId, UUID tenantId);
}
