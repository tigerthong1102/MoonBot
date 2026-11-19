function Audit-HtmlText($value) { [Net.WebUtility]::HtmlEncode([string]$value) }

function Format-AuditReport($report) {
    $html=[Text.StringBuilder]::new()
    [void]$html.Append(@'
<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Giấy làm việc kiểm toán</title><style>body{max-width:78rem;margin:2rem auto;padding:0 1rem;font:16px system-ui;color:#192f38}table{border-collapse:collapse;margin:1rem 0}td,th{padding:.45rem .7rem;border:1px solid #bdc8ca;text-align:left}th{background:#edf2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:1.65rem}@media print{tr{break-inside:avoid}}</style><h1>Giấy làm việc rà soát số liệu</h1>
'@)
    [void]$html.Append('<p>Thời điểm UTC · '+(Audit-HtmlText $report.generatedUtc)+'</p>')
    if ($report.left) {
        [void]$html.Append('<table><tr><th>Nguồn</th><th>Dòng nguồn</th><th>Trong phạm vi</th><th>Sau lọc</th><th>Tổng theo phép kiểm</th></tr>')
        foreach ($side in @('left','right')) {
            $s=$report[$side]
            if (!$s) { continue }
            $label=if ($side -eq 'left') {'A'} else {'B'}
            [void]$html.Append("<tr><td>$label</td><td>$($s.sourceRows)</td><td>$($s.scopedRows)</td><td>$($s.selectedRows)</td><td>$(Audit-HtmlText $s.total)</td></tr>")
        }
        [void]$html.Append('</table>')
    }
    if ($report.operation -eq 'compare') {
        [void]$html.Append("<p>Số khóa khớp: $($report.matched) / $($report.keys). Ngoại lệ cần soát xét: $($report.exceptions.Count).</p>")
        if ($report.exceptions.Count) {
            $labels=@{only_left='Chỉ có ở A';only_right='Chỉ có ở B';amount_difference='Lệch tiền';field_difference='Khác trường';review_grain='Nhiều dòng cùng khóa'}
            [void]$html.Append('<table><tr><th>Khóa</th><th>Kết quả</th><th>Số tiền A</th><th>Số tiền B</th><th>A trừ B</th><th>Trường khác</th><th>Dòng A / B</th></tr>')
            foreach ($v in $report.exceptions) {
                [void]$html.Append('<tr>')
                foreach ($cell in @($v.key,$labels[$v.status],$v.leftAmount,$v.rightAmount,$v.difference,($v.differentFields -join ', '),(($v.leftRows -join ', ')+' / '+($v.rightRows -join ', ')))) {
                    [void]$html.Append('<td>'+(Audit-HtmlText $cell)+'</td>')
                }
                [void]$html.Append('</tr>')
            }
            [void]$html.Append('</table>')
        }
    } elseif ($report.operation -eq 'find') {
        [void]$html.Append('<h2>Dòng tìm thấy</h2><table><tr><th>Dòng</th><th>Khóa</th><th>Giá trị đã chọn</th></tr>')
        foreach ($hit in $report.matches) {
            [void]$html.Append('<tr><td>'+(Audit-HtmlText $hit.row)+'</td><td>'+(Audit-HtmlText $hit.key)+'</td><td>')
            foreach ($entry in $hit.fields.GetEnumerator()) {
                [void]$html.Append((Audit-HtmlText $entry.Key)+' = '+(Audit-HtmlText $entry.Value)+'<br>')
            }
            [void]$html.Append('</td></tr>')
        }
        [void]$html.Append('</table>')
    }
    $meta=[ordered]@{}
    foreach ($entry in $report.GetEnumerator()) { if ($entry.Key -notin @('matches','exceptions')) { $meta.Add($entry.Key,$entry.Value) } }
    [void]$html.Append('<h2>Phạm vi và cách chạy lại</h2><pre>'+(Audit-HtmlText (ConvertTo-Json -InputObject $meta -Depth 8))+'</pre><p>Người soát xét đối chiếu các ngoại lệ với bằng chứng gốc trước khi kết luận. Kết quả trên chỉ áp dụng cho nguồn và phạm vi đã ghi.</p></html>')
    return $html.ToString()
}
