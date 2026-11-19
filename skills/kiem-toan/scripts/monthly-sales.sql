SET LOCK_TIMEOUT 3000;
SELECT TOP (20001) v.RefID,v.RefNoFinance,CONVERT(char(10),v.PostedDate,23),
       CONVERT(varchar(48),v.TotalSaleAmount),CONVERT(varchar(48),SUM(d.Amount)),COUNT_BIG(d.RefDetailID)
FROM dbo.SAVoucher AS v LEFT JOIN dbo.SAVoucherDetail AS d ON d.RefID=v.RefID
WHERE v.BranchID=@branch AND v.PostedDate>=@start AND v.PostedDate<@end AND v.IsPostedFinance=1
GROUP BY v.RefID,v.RefNoFinance,v.PostedDate,v.TotalSaleAmount
ORDER BY v.PostedDate,v.RefID
