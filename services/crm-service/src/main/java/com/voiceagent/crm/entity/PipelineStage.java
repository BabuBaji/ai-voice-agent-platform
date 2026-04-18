package com.voiceagent.crm.entity;

import jakarta.persistence.*;
import lombok.*;

import java.util.UUID;

@Entity
@Table(name = "pipeline_stages")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PipelineStage {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pipeline_id", nullable = false)
    private Pipeline pipeline;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Integer position;

    private String color;
}
