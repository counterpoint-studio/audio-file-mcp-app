#ifndef AUDIOFILE_MCP_RENDER_H
#define AUDIOFILE_MCP_RENDER_H

#include <stdint.h>

void render_kernel(
    const float* grid,
    int cols,
    int num_bins,
    float floor_db,
    float ceil_db,
    float ref,
    float floor_value,
    float db_mult,
    const uint8_t* lut,
    uint8_t* out_rgba);

#endif
