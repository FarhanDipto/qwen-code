/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import type { HistoryItemTurnTokens } from '../../types.js';
import { ICON } from '../../constants.js';

const fmt = (value: number): string => value.toLocaleString('en-US');

export const TurnTokensMessage: React.FC<{
  item: HistoryItemTurnTokens;
}> = ({ item }) => {
  const parts = [`${fmt(item.turnInput)} in`, `${fmt(item.turnOutput)} out`];

  if (item.turnCached > 0) {
    parts.push(`${fmt(item.turnCached)} cached`);
  }
  if (item.requests > 1) {
    parts.push(`${item.requests} calls`);
  }
  parts.push(`${(item.durationMs / 1000).toFixed(1)}s`);

  return (
    <Box flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text dimColor>{ICON.CIRCLE_FILLED}</Text>
      </Box>
      <Text dimColor>
        {parts.join(' · ')}
        {` · session ${fmt(item.sessionTotal)} · context ${fmt(item.contextTokens)}`}
      </Text>
    </Box>
  );
};
