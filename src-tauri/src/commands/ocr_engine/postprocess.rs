//! Detection and recognition post-processing.

use image::DynamicImage;
use image::GenericImageView;
use ndarray::{Array, IxDyn};
use std::sync::LazyLock;

// Detection threshold for text region confidence.
pub const DET_THRESHOLD: f32 = 0.3;
// Minimum box height (pixels) to be considered valid text.
pub const MIN_BOX_HEIGHT: f32 = 8.0;
// Minimum box width (pixels) to be considered valid text.
pub const MIN_BOX_WIDTH: f32 = 2.0;

/// Full PP-OCR keys vocabulary string (6623 characters).
pub const PPOCR_KEYS_RAW: &str = include_str!("ppocr_keys_v1.txt");

/// Lazy-loaded complete character vocabulary vector for PP-OCR inference.
pub static PPOCR_VOCAB: LazyLock<Vec<char>> = LazyLock::new(|| {
    let mut vocab = Vec::with_capacity(6630);
    for line in PPOCR_KEYS_RAW.lines() {
        if let Some(ch) = line.chars().next() {
            vocab.push(ch);
        }
    }
    vocab
});

/// Fallback character vocabulary (common CJK + Latin).
pub const DEFAULT_VOCAB: &[char] = &[
    ' ', '!', '"', '#', '$', '%', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '/', '0', '1', '2',
    '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '@', 'A', 'B', 'C', 'D', 'E',
    'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
    'Y', 'Z', '[', '\\', ']', '^', '_', '`', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k',
    'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '{', '|', '}', '~',
    '一', '的', '是', '在', '不', '了', '有', '和', '人', '这', '中', '大', '为', '上', '个', '国',
    '我', '以', '要', '他', '时', '来', '用', '们', '生', '到', '作', '地', '于', '出', '就', '分',
    '对', '成', '会', '可', '主', '发', '年', '动', '同', '工', '也', '能', '下', '过', '子', '说',
    '产', '种', '面', '而', '方', '后', '多', '定', '行', '学', '法', '所', '民', '得', '经', '十',
    '三', '之', '进', '着', '等', '部', '度', '家', '电', '力', '里', '如', '水', '化', '高', '自',
    '二', '理', '起', '小', '物', '现', '实', '加', '量', '都', '两', '体', '制', '机', '当', '使',
    '点', '从', '业', '本', '去', '把', '性', '好', '应', '开', '它', '合', '还', '因', '由', '其',
    '些', '然', '前', '外', '天', '政', '四', '日', '那', '社', '义', '事', '平', '形', '相', '全',
    '表', '间', '样', '与', '关', '各', '重', '新', '线', '内', '数', '正', '心', '反', '你', '明',
    '看', '原', '又', '么', '利', '比', '或', '但', '质', '气', '第', '向', '道', '命', '此', '变',
    '条', '只', '没', '结', '解', '问', '意', '建', '月', '公', '无', '系', '军', '很', '情', '者',
    '最', '立', '代', '想', '已', '通', '并', '提', '直', '题', '党', '程', '展', '五', '果', '料',
    '象', '员', '革', '位', '入', '常', '文', '总', '次', '品', '式', '活', '设', '及', '管', '特',
    '件', '长', '求', '老', '头', '基', '资', '边', '流', '路', '级', '少', '图', '山', '统', '接',
    '知', '较', '将', '组', '见', '计', '别', '她', '手', '角', '期', '根', '论', '运', '农', '指',
    '几', '九', '区', '强', '放', '决', '西', '被', '干', '做', '必', '战', '先', '回', '则', '任',
    '取', '据', '处', '队', '南', '给', '色', '光', '门', '即', '保', '治', '北', '造', '百', '规',
    '热', '领', '七', '海', '口', '东', '导', '器', '压', '志', '世', '金', '增', '争', '济', '阶',
    '油', '思', '术', '极', '交', '受', '联', '什', '认', '六', '共', '权', '收', '证', '改', '清',
    '己', '美', '再', '采', '转', '更', '单', '风', '切', '打', '白', '教', '速', '花', '带', '安',
    '场', '身', '车', '例', '真', '务', '具', '万', '每', '目', '至', '达', '走', '积', '示', '议',
    '声', '报', '斗', '完', '类', '八', '离', '华', '名', '确', '才', '科', '张', '信', '马', '节',
    '话', '米', '整', '空', '元', '况', '今', '集', '温', '传', '土', '许', '步', '群', '广', '石',
    '记', '需', '段', '研', '界', '拉', '林', '律', '叫', '且', '究', '观', '越', '织', '装', '影',
    '算', '低', '持', '音', '众', '书', '布', '复', '容', '儿', '须', '际', '商', '非', '验', '连',
    '断', '深', '难', '近', '矿', '千', '周', '委', '股', '始',
];

/// Decode raw model output into text bounding boxes.
pub fn decode_boxes(
    output: &Array<f32, IxDyn>,
    orig_w: f32,
    orig_h: f32,
    img_w: u32,
    img_h: u32,
) -> Vec<[f32; 4]> {
    let shape = output.shape();
    if shape.len() < 4 {
        return vec![];
    }

    let out_h = shape[2];
    let out_w = shape[3];

    let mut boxes: Vec<[f32; 4]> = Vec::new();

    let scale_x = img_w as f32 / out_w as f32;
    let scale_y = img_h as f32 / out_h as f32;

    let mut visited = vec![false; out_h * out_w];
    let mut queue: Vec<(usize, usize)> = Vec::new();

    for y in 0..out_h {
        for x in 0..out_w {
            if visited[y * out_w + x] {
                continue;
            }
            let val = output[[0, 0, y, x]];
            if val > DET_THRESHOLD {
                queue.clear();
                queue.push((x, y));
                visited[y * out_w + x] = true;

                let mut min_x = x;
                let mut max_x = x;
                let mut min_y = y;
                let mut max_y = y;

                while let Some((cx, cy)) = queue.pop() {
                    min_x = min_x.min(cx);
                    max_x = max_x.max(cx);
                    min_y = min_y.min(cy);
                    max_y = max_y.max(cy);

                    let neighbours = [
                        (cx.wrapping_sub(1), cy),
                        (cx + 1, cy),
                        (cx, cy.wrapping_sub(1)),
                        (cx, cy + 1),
                    ];

                    for (nx, ny) in neighbours {
                        if nx < out_w
                            && ny < out_h
                            && !visited[ny * out_w + nx]
                            && output[[0, 0, ny, nx]] > DET_THRESHOLD
                        {
                            visited[ny * out_w + nx] = true;
                            queue.push((nx, ny));
                        }
                    }
                }

                let x1 = min_x as f32 * scale_x;
                let y1 = min_y as f32 * scale_y;
                let x2 = (max_x as f32 + 1.0) * scale_x;
                let y2 = (max_y as f32 + 1.0) * scale_y;

                if (x2 - x1) >= MIN_BOX_WIDTH && (y2 - y1) >= MIN_BOX_HEIGHT {
                    boxes.push([x1, y1, x2, y2]);
                }
            } else {
                visited[y * out_w + x] = true;
            }
        }
    }

    let ratio_x = orig_w / img_w as f32;
    let ratio_y = orig_h / img_h as f32;

    boxes
        .iter()
        .map(|&[x1, y1, x2, y2]| [x1 * ratio_x, y1 * ratio_y, x2 * ratio_x, y2 * ratio_y])
        .collect()
}

/// Simple NMS (non-maximum suppression) to merge overlapping boxes.
pub fn nms_boxes(boxes: &[[f32; 4]], iou_threshold: f32) -> Vec<[f32; 4]> {
    if boxes.is_empty() {
        return vec![];
    }

    let mut sorted: Vec<(usize, &[f32; 4])> = boxes.iter().enumerate().collect();
    sorted.sort_by(|a, b| {
        let area_a = (a.1[2] - a.1[0]) * (a.1[3] - a.1[1]);
        let area_b = (b.1[2] - b.1[0]) * (b.1[3] - b.1[1]);
        area_b
            .partial_cmp(&area_a)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut selected: Vec<[f32; 4]> = Vec::new();

    for &(_, bbox) in &sorted {
        let mut keep = true;
        for sel in &selected {
            let inter_x1 = bbox[0].max(sel[0]);
            let inter_y1 = bbox[1].max(sel[1]);
            let inter_x2 = bbox[2].min(sel[2]);
            let inter_y2 = bbox[3].min(sel[3]);

            if inter_x2 <= inter_x1 || inter_y2 <= inter_y1 {
                continue;
            }

            let inter_area = (inter_x2 - inter_x1) * (inter_y2 - inter_y1);
            let bbox_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
            let sel_area = (sel[2] - sel[0]) * (sel[3] - sel[1]);
            let union_area = bbox_area + sel_area - inter_area;

            if union_area > 0.0 && inter_area / union_area > iou_threshold {
                keep = false;
                break;
            }
        }
        if keep {
            selected.push(*bbox);
        }
    }

    selected
}

/// Simple greedy CTC decoder.
pub fn ctc_decode(output: &Array<f32, IxDyn>) -> String {
    let shape = output.shape();
    if shape.len() < 3 {
        return String::new();
    }

    let timesteps = shape[1];
    let vocab_size = shape[2];

    let mut indices: Vec<usize> = Vec::with_capacity(timesteps);
    for t in 0..timesteps {
        let mut best_idx = 0usize;
        let mut best_val = f32::NEG_INFINITY;
        for c in 0..vocab_size {
            let val = output[[0, t, c]];
            if val > best_val {
                best_val = val;
                best_idx = c;
            }
        }
        indices.push(best_idx);
    }

    let mut result = String::new();
    let mut prev = 0usize;
    let full_vocab = &*PPOCR_VOCAB;

    for &idx in &indices {
        if idx != prev && idx != 0 {
            // First try the complete 6623 character PP-OCR vocabulary
            let target_char = if let Some(&ch) = full_vocab.get(idx.wrapping_sub(1)) {
                Some(ch)
            } else {
                DEFAULT_VOCAB.get(idx.wrapping_sub(1)).copied()
            };

            if let Some(ch) = target_char {
                result.push(ch);
            }
        }
        prev = idx;
    }

    result
}

/// Simple image hash for cache key (djb2 variant on pixel data).
pub fn simple_hash(img: &DynamicImage) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let (w, h) = img.dimensions();
    w.hash(&mut hasher);
    h.hash(&mut hasher);

    let gray = img.to_luma8();
    for y in (0..h).step_by(10) {
        for x in (0..w).step_by(10) {
            hasher.write_u8(gray.get_pixel(x, y)[0]);
        }
    }
    hasher.finish()
}

/// Compute average confidence from recognition softmax output.
pub fn compute_confidence(output: &Array<f32, IxDyn>) -> f32 {
    let shape = output.shape();
    if shape.len() < 3 || shape[1] == 0 {
        return 0.0;
    }

    let timesteps = shape[1];
    let mut sum = 0.0f32;
    let mut count = 0usize;

    for t in 0..timesteps {
        let mut best_val = f32::NEG_INFINITY;
        for c in 0..shape[2] {
            let val = output[[0, t, c]];
            if val > best_val {
                best_val = val;
            }
        }
        if best_val > 0.0 {
            sum += best_val;
            count += 1;
        }
    }

    if count > 0 {
        sum / count as f32
    } else {
        0.0
    }
}
