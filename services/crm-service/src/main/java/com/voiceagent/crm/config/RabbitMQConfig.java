package com.voiceagent.crm.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMQConfig {

    public static final String CRM_EVENTS_EXCHANGE = "crm.events";
    public static final String LEAD_EVENTS_QUEUE = "crm.lead.events";
    public static final String DEAL_EVENTS_QUEUE = "crm.deal.events";

    @Bean
    public TopicExchange crmEventsExchange() {
        return new TopicExchange(CRM_EVENTS_EXCHANGE);
    }

    @Bean
    public Queue leadEventsQueue() {
        return QueueBuilder.durable(LEAD_EVENTS_QUEUE).build();
    }

    @Bean
    public Queue dealEventsQueue() {
        return QueueBuilder.durable(DEAL_EVENTS_QUEUE).build();
    }

    @Bean
    public Binding leadEventsBinding(Queue leadEventsQueue, TopicExchange crmEventsExchange) {
        return BindingBuilder.bind(leadEventsQueue).to(crmEventsExchange).with("crm.lead.*");
    }

    @Bean
    public Binding dealEventsBinding(Queue dealEventsQueue, TopicExchange crmEventsExchange) {
        return BindingBuilder.bind(dealEventsQueue).to(crmEventsExchange).with("crm.deal.*");
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
