package com.voiceagent.identity.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "jwt")
public class JwtConfig {

    private String secret;
    private long expiration = 900000; // 15 minutes
    private long refreshExpiration = 604800000; // 7 days
}
