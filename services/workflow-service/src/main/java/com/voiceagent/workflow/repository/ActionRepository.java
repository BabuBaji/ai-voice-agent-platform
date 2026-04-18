package com.voiceagent.workflow.repository;

import com.voiceagent.workflow.entity.Action;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ActionRepository extends JpaRepository<Action, UUID> {

    List<Action> findByWorkflowIdOrderByPositionAsc(UUID workflowId);
}
