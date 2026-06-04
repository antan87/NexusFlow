/**
 * @module analyzers/messaging-analyzer
 * Detects publishers and subscribers for pub/sub messaging topologies
 * across multiple programming languages and frameworks.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import type { MessagingTopology, MessagePublisher, MessageSubscriber } from '../types.js';

/**
 * Analyzes messaging/event topology in a repository.
 *
 * Scans C#, JS/TS, Python, and Go source files for publish and subscribe
 * patterns and extracts message/event contracts.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Detected publishers and subscribers.
 */
export async function analyzeMessaging(repoPath: string): Promise<MessagingTopology> {
  const publishers: MessagePublisher[] = [];
  const subscribers: MessageSubscriber[] = [];

  try {
    const files = await globby(
      ['**/*.ts', '**/*.js', '**/*.cs', '**/*.py', '**/*.go'],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      }
    );

    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 200_000) continue; // Skip large files

        const content = await fs.readFile(file, 'utf-8');
        const relPath = path.relative(repoPath, file).replace(/\\/g, '/');

        if (file.endsWith('.cs')) {
          // ── C# Messaging Patterns ────────────────────────────────────────

          // MediatR notification handler
          // INotificationHandler<MyNotification>
          const mediatrSubRegex = /:\s*INotificationHandler\s*<\s*(\w+)\s*>/g;
          let match: RegExpExecArray | null;
          while ((match = mediatrSubRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: match[1]!,
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // MediatR command/query handler
          // IRequestHandler<MyRequest, MyResponse> or IRequestHandler<MyRequest>
          const requestHandlerRegex = /:\s*IRequestHandler\s*<\s*(\w+)(?:\s*,\s*\w+)?\s*>/g;
          while ((match = requestHandlerRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: match[1]!,
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // MassTransit Consumer: IConsumer<MyMessage>
          const massTransitSubRegex = /:\s*IConsumer\s*<\s*(\w+)\s*>/g;
          while ((match = massTransitSubRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: match[1]!,
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // NServiceBus Handler: IHandleMessages<MyMessage>
          const nserviceBusSubRegex = /:\s*IHandleMessages\s*<\s*(\w+)\s*>/g;
          while ((match = nserviceBusSubRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: match[1]!,
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // Azure Service Bus triggers: [ServiceBusTrigger("queueOrTopicName")]
          const sbtRegex = /\[ServiceBusTrigger\s*\(\s*"([^"]+)"(?:\s*,\s*"[^"]+")?\s*\)\]/g;
          while ((match = sbtRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: 'ServiceBusMessage',
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // Publishers in C#
          // .Publish<MyEvent>( or .PublishAsync<MyEvent>( or .Send<MyCommand>( or .SendAsync<MyCommand>(
          const csPubRegex = /\b(?:Publish|PublishAsync|Send|SendAsync)\s*<\s*(\w+)\s*>\s*\(/g;
          while ((match = csPubRegex.exec(content)) !== null) {
            publishers.push({
              contractType: match[1]!,
              topicOrQueue: 'direct/inferred',
              publisherFile: relPath,
            });
          }
          
          const mediatorSendRegex = /\bmediator\s*\.\s*(?:Send|Publish)\s*\(\s*new\s+(\w+)\s*\(/gi;
          while ((match = mediatorSendRegex.exec(content)) !== null) {
            publishers.push({
              contractType: match[1]!,
              topicOrQueue: 'mediator',
              publisherFile: relPath,
            });
          }

        } else if (file.endsWith('.ts') || file.endsWith('.js')) {
          // ── TS/JS Messaging Patterns ─────────────────────────────────────

          // EventEmitter emitters: emit('event-name', ...)
          const tsEmitRegex = /\bemit\s*\(\s*['"`]([^'"`]+)['"`]/g;
          let match: RegExpExecArray | null;
          while ((match = tsEmitRegex.exec(content)) !== null) {
            publishers.push({
              contractType: match[1]!,
              topicOrQueue: 'EventEmitter',
              publisherFile: relPath,
            });
          }

          // EventEmitter listeners: on('event-name', ...) or addListener('event-name', ...)
          const tsOnRegex = /\b(?:on|addListener)\s*\(\s*['"`]([^'"`]+)['"`]/g;
          while ((match = tsOnRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: match[1]!,
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // Kafka/RabbitMQ subscribe: topic: 'topic-name' inside subscription object
          const tsSubTopicRegex = /topic\s*:\s*['"`]([^'"`]+)['"`]/g;
          while ((match = tsSubTopicRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: 'Kafka/MQ Message',
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // BullMQ add: queue.add('job-name', ...)
          const bullmqAddRegex = /\badd\s*\(\s*['"`]([^'"`]+)['"`]/g;
          while ((match = bullmqAddRegex.exec(content)) !== null) {
            publishers.push({
              contractType: match[1]!,
              topicOrQueue: 'BullMQ',
              publisherFile: relPath,
            });
          }

        } else if (file.endsWith('.py')) {
          // ── Python Messaging Patterns ────────────────────────────────────

          // Celery task definitions: @app.task or @shared_task
          const celeryTaskRegex = /@(?:[a-zA-Z0-9_]+\.)?(?:task|shared_task)(?:\([^)]*\))?\s*\n\s*def\s+(\w+)\s*\(/g;
          let match: RegExpExecArray | null;
          while ((match = celeryTaskRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: match[1]!,
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }

          // Celery task invocations: task.delay(...) or task.apply_async(...)
          const celeryDelayRegex = /\b(\w+)\s*\.\s*(?:delay|apply_async)\s*\(/g;
          while ((match = celeryDelayRegex.exec(content)) !== null) {
            publishers.push({
              contractType: match[1]!,
              topicOrQueue: 'Celery',
              publisherFile: relPath,
            });
          }

          // RabbitMQ basic_publish: routing_key='key'
          const pikaPublishRegex = /routing_key\s*=\s*['"`]([^'"`]+)['"`]/g;
          while ((match = pikaPublishRegex.exec(content)) !== null) {
            publishers.push({
              contractType: match[1]!,
              topicOrQueue: 'RabbitMQ',
              publisherFile: relPath,
            });
          }

        } else if (file.endsWith('.go')) {
          // ── Go Messaging Patterns ────────────────────────────────────────

          // Go publish/produce calls: Publish("topic", ...) or Produce("topic", ...)
          const goPubRegex = /\b(?:Publish|Produce|Send)\s*\(\s*['"`]([^'"`]+)['"`]/g;
          let match: RegExpExecArray | null;
          while ((match = goPubRegex.exec(content)) !== null) {
            publishers.push({
              contractType: 'GoMessage',
              topicOrQueue: match[1]!,
              publisherFile: relPath,
            });
          }

          // Go subscribe/consume calls: Subscribe("topic", ...) or Consume("topic", ...)
          const goSubRegex = /\b(?:Subscribe|Consume)\s*\(\s*['"`]([^'"`]+)['"`]/g;
          while ((match = goSubRegex.exec(content)) !== null) {
            subscribers.push({
              contractType: 'GoMessage',
              handlerFile: relPath,
              registrationFile: relPath,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Ignore errors
  }

  // De-duplicate publishers & subscribers
  const uniquePublishers: MessagePublisher[] = [];
  const seenPub = new Set<string>();
  for (const p of publishers) {
    const key = `${p.contractType}:${p.topicOrQueue}:${p.publisherFile}`;
    if (!seenPub.has(key)) {
      seenPub.add(key);
      uniquePublishers.push(p);
    }
  }

  const uniqueSubscribers: MessageSubscriber[] = [];
  const seenSub = new Set<string>();
  for (const s of subscribers) {
    const key = `${s.contractType}:${s.handlerFile}:${s.registrationFile}`;
    if (!seenSub.has(key)) {
      seenSub.add(key);
      uniqueSubscribers.push(s);
    }
  }

  return {
    publishers: uniquePublishers,
    subscribers: uniqueSubscribers,
  };
}
