--select mem.Name, count(mks_att.Committeemeeting_id), com.Date 
--select mem.Name, mks_att.Committeemeeting_id, com.Date 
select mem.Name, count(mks_att.Committeemeeting_id)
from committees_committeemeeting_mks_attended mks_att, mks_member mem, committees_committeemeeting com 
where mem.Id = mks_att.Member_id and mks_att.Committeemeeting_id = com.Id
and Date >= '10/30/16' and Date <= '03/26/17'
group by Member_id, mem.Name
--group by mem.Name, com.Date 
--limit 100;


-- committee name and id
select id, name
from committees_committ
limit 20;


select *
from committees_committeemeeting
where Date >= '10/30/16' and Date <= '03/26/17'
limit 20
;

-- committee name & meeting topic
select committees_committee.name, committees_committeemeeting.topics, committees_committeemeeting.date
from committees_committeemeeting
join committees_committee on committees_committee.id = committees_committeemeeting.committee_id
where committees_committeemeeting.Date >= '01/01/17' and committees_committeemeeting.Date <= '03/26/17'
and not committees_committeemeeting.topics like ('%הצעת חוק%')
order by committees_committee.id
;

select committees_committee.name, committees_committeemeeting.topics, committees_committeemeeting.date
from committees_committeemeeting
join committees_committee on committees_committee.id = committees_committeemeeting.committee_id
where committees_committeemeeting.Date >= '01/01/17' and committees_committeemeeting.Date <= '03/26/17'
and not committees_committeemeeting.topics like ('%הצעת חוק%')
order by committees_committee.id
;